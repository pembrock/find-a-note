//go:build darwin && cgo

package midi

/*
#cgo CFLAGS: -fblocks
#cgo LDFLAGS: -framework CoreMIDI -framework CoreFoundation
#include <CoreMIDI/CoreMIDI.h>
#include <stdint.h>
void fanPollRunLoop(void);
OSStatus fanDisposeClient(MIDIClientRef client);
OSStatus fanDisposePort(MIDIPortRef port);
OSStatus fanCreateClient(MIDIClientRef *client);
OSStatus fanCreatePort(MIDIClientRef client, MIDIPortRef *port, uintptr_t token);
int fanSourceName(MIDIEndpointRef source, char *name, CFIndex size);
*/
import "C"

import (
	"errors"
	"fmt"
	"log"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
)

type NativeDriver struct{ client C.MIDIClientRef }

// CoreMIDI keeps the run loop of the FIRST MIDIClientCreate in the process,
// even after that client is disposed. Keep that thread alive across managers;
// locking each manager separately allows the next one to poll the wrong loop.
var darwinRunLoop = sync.OnceValue(func() chan func() {
	requests := make(chan func())
	go func() {
		runtime.LockOSThread()
		for request := range requests {
			request()
		}
	}()
	return requests
})

func onDarwinRunLoop(fn func()) {
	done := make(chan struct{})
	darwinRunLoop() <- func() { fn(); close(done) }
	<-done
}

func (driver *NativeDriver) List() ([]Device, error) {
	var devices []Device
	var err error
	onDarwinRunLoop(func() { devices, err = driver.listOnRunLoop() })
	return devices, err
}

func (driver *NativeDriver) listOnRunLoop() ([]Device, error) {
	if driver.client == 0 {
		if err := midiStatus("create client", C.fanCreateClient(&driver.client)); err != nil {
			return nil, err
		}
	}
	C.fanPollRunLoop()
	devices := []Device{}
	count := C.MIDIGetNumberOfSources()
	for i := C.ItemCount(0); i < count; i++ {
		source := C.MIDIGetSource(i)
		if source == 0 {
			continue
		}
		var offline, unique C.SInt32
		if C.MIDIObjectGetIntegerProperty(source, C.kMIDIPropertyOffline, &offline) == 0 && offline != 0 {
			continue
		}
		identity := ""
		if C.MIDIObjectGetIntegerProperty(source, C.kMIDIPropertyUniqueID, &unique) == 0 && unique != 0 {
			identity = fmt.Sprintf("coremidi:%d", int32(unique))
		}
		name := "CoreMIDI"
		var buffer [1024]C.char
		if C.fanSourceName(source, &buffer[0], C.CFIndex(len(buffer))) != 0 && buffer[0] != 0 {
			name = C.GoString(&buffer[0])
		}
		devices = append(devices, Device{ID: fmt.Sprintf("%d|%s", uint32(source), identity), Name: name, Identity: identity})
	}
	return devices, nil
}

type darwinReceiver struct {
	mu   sync.RWMutex
	sink func(Packet)
}

var darwinReceivers sync.Map
var darwinToken atomic.Uint64

func decodeUMP(word uint32) (Packet, bool) {
	if word>>28 != 2 {
		return Packet{}, false
	}
	status, first, second := word>>16&255, word>>8&255, word&255
	if first > 127 || second > 127 {
		return Packet{}, false
	}
	switch status & 0xf0 {
	case 0x80, 0x90:
	case 0xb0:
		if first != 120 && first != 123 {
			return Packet{}, false
		}
	default:
		return Packet{}, false
	}
	return Packet{Message: status | first<<8 | second<<16}, true
}

//export fanReceiveUMP
func fanReceiveUMP(token C.uintptr_t, word C.uint32_t) {
	packet, ok := decodeUMP(uint32(word))
	if !ok {
		return
	}
	if entry, ok := darwinReceivers.Load(uint64(token)); ok {
		receiver := entry.(*darwinReceiver)
		receiver.mu.RLock()
		defer receiver.mu.RUnlock()
		if receiver.sink != nil {
			receiver.sink(packet)
		}
	}
}

type darwinInput struct {
	device   Device
	source   C.MIDIEndpointRef
	driver   *NativeDriver
	port     C.MIDIPortRef
	token    uint64
	receiver *darwinReceiver
	started  bool
}

func (driver *NativeDriver) Open(device Device, sink func(Packet)) (Input, error) {
	handle, err := strconv.ParseUint(strings.SplitN(device.ID, "|", 2)[0], 10, 32)
	if err != nil {
		return nil, err
	}
	input := &darwinInput{driver: driver, device: device, source: C.MIDIEndpointRef(handle)}
	if err := input.Check(); err != nil {
		return nil, err
	}
	input.receiver = &darwinReceiver{sink: sink}
	input.token = darwinToken.Add(1)
	darwinReceivers.Store(input.token, input.receiver)
	var port C.MIDIPortRef
	err = midiStatus("create port", C.fanCreatePort(driver.client, &port, C.uintptr_t(input.token)))
	input.port = port
	if err != nil {
		return nil, errors.Join(err, input.Close())
	}
	return input, nil
}

func (input *darwinInput) Start() error {
	if input.port == 0 {
		return errors.New("CoreMIDI port is closed")
	}
	if input.started {
		return nil
	}
	if err := input.Check(); err != nil {
		return err
	}
	err := midiStatus("connect source", C.MIDIPortConnectSource(input.port, input.source, nil))
	input.started = err == nil
	return err
}

func (input *darwinInput) Check() error {
	devices, err := input.driver.List()
	if err != nil {
		return err
	}
	for _, device := range devices {
		if device == input.device {
			return nil
		}
	}
	return errors.New("CoreMIDI source disappeared or changed")
}

func (input *darwinInput) Close() error {
	// The block captures only a token. Remove its entry and drain any callback
	// already using the sink before releasing native resources.
	if input.receiver != nil {
		darwinReceivers.Delete(input.token)
		input.receiver.mu.Lock()
		input.receiver.sink = nil
		input.receiver.mu.Unlock()
		input.receiver = nil
	}
	if input.started {
		// A removed endpoint may already be disconnected. Disposing the port
		// below releases every remaining connection.
		status := C.MIDIPortDisconnectSource(input.port, input.source)
		_ = midiStatus("disconnect source", status)
		input.started = false
	}
	if input.port == 0 {
		return nil
	}
	err := midiStatus("dispose port", C.fanDisposePort(input.port))
	if err == nil {
		input.port = 0
	}
	return err
}

func (driver *NativeDriver) Close() error {
	if driver.client == 0 {
		return nil
	}
	var err error
	onDarwinRunLoop(func() { err = midiStatus("dispose client", C.fanDisposeClient(driver.client)) })
	if err == nil {
		driver.client = 0
	}
	return err
}

func midiStatus(operation string, status C.OSStatus) error {
	if os.Getenv("FIND_A_NOTE_MIDI_TRACE") != "" {
		log.Printf("CoreMIDI %s status=%d", operation, int32(status))
	}
	if status == 0 {
		return nil
	}
	return fmt.Errorf("CoreMIDI %s: OSStatus %d", operation, int32(status))
}
