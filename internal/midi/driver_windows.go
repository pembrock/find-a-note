//go:build windows

package midi

import (
	"fmt"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var winmm = windows.NewLazySystemDLL("winmm.dll")
var getNum = winmm.NewProc("midiInGetNumDevs")
var getCaps = winmm.NewProc("midiInGetDevCapsW")
var openIn = winmm.NewProc("midiInOpen")
var startIn = winmm.NewProc("midiInStart")
var stopIn = winmm.NewProc("midiInStop")
var resetIn = winmm.NewProc("midiInReset")
var closeIn = winmm.NewProc("midiInClose")

type caps struct {
	Manufacturer, Product uint16
	Version               uint32
	Name                  [32]uint16
	Support               uint32
}

func readCaps(id uintptr) (caps, error) {
	var c caps
	code, _, _ := getCaps.Call(id, uintptr(unsafe.Pointer(&c)), unsafe.Sizeof(c))
	return c, resultError(code)
}
func identity(c caps) string {
	return fmt.Sprintf("%d:%d:%d:%s", c.Manufacturer, c.Product, c.Version, windows.UTF16ToString(c.Name[:]))
}

type NativeDriver struct{}

func (NativeDriver) List() ([]Device, error) {
	if err := winmm.Load(); err != nil {
		return nil, fmt.Errorf("WinMM недоступен")
	}
	count, _, _ := getNum.Call()
	devices := []Device{}
	for index := uintptr(0); index < count; index++ {
		c, err := readCaps(index)
		if err != nil {
			return nil, err
		}
		key := identity(c)
		devices = append(devices, Device{ID: strconv.FormatUint(uint64(index), 10) + "|" + key, Name: windows.UTF16ToString(c.Name[:]), Identity: key})
	}
	return devices, nil
}

// One process-wide callback avoids leaking a Go callback trampoline per reconnect.
// Only integer tokens cross the API boundary; there are no stored Go pointers in WinMM.
var sinks sync.Map
var nextToken atomic.Uint64
var callback = syscall.NewCallback(func(handle, msg, token, p1, p2 uintptr) uintptr {
	if msg == 0x3c3 || msg == 0x3cc || msg == 0x3c2 { // DATA, MOREDATA, CLOSE
		if sink, ok := sinks.Load(token); ok {
			sink.(func(Packet))(Packet{Message: uint32(p1), Closed: msg == 0x3c2})
		}
	}
	return 0
})

type nativeInput struct {
	handle, token uintptr
	identity      string
}

func (NativeDriver) Open(d Device, sink func(Packet)) (Input, error) {
	index, err := strconv.ParseUint(strings.SplitN(d.ID, "|", 2)[0], 10, 32)
	if err != nil {
		return nil, fmt.Errorf("неверный MIDI-порт")
	}
	c, err := readCaps(uintptr(index))
	if err != nil {
		return nil, err
	}
	if identity(c) != d.Identity {
		return nil, fmt.Errorf("список устройств изменился")
	}
	token := uintptr(nextToken.Add(1))
	sinks.Store(token, sink)
	n := &nativeInput{token: token, identity: d.Identity}
	code, _, _ := openIn.Call(uintptr(unsafe.Pointer(&n.handle)), uintptr(index), callback, token, 0x30000|0x20)
	if err = resultError(code); err != nil {
		sinks.Delete(token)
		return nil, err
	}
	return n, nil
}
func (n *nativeInput) Start() error { code, _, _ := startIn.Call(n.handle); return resultError(code) }
func (n *nativeInput) Check() error {
	c, err := readCaps(n.handle)
	if err != nil {
		return err
	}
	if identity(c) != n.identity {
		return fmt.Errorf("MIDI-порт изменился")
	}
	return nil
}
func (n *nativeInput) Close() error {
	sinks.Delete(n.token)
	if n.handle == 0 {
		return nil
	}
	stopIn.Call(n.handle)
	resetIn.Call(n.handle)
	code, _, _ := closeIn.Call(n.handle)
	if code == 5 {
		code = 0
	} // Already closed by the driver.
	if err := resultError(code); err != nil {
		return err
	}
	n.handle = 0
	return nil
}
