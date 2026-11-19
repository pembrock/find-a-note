//go:build windows

package midi

import (
	"testing"
	"unsafe"
)

func TestNativeWindowsInputEnumeration(t *testing.T) {
	if unsafe.Sizeof(caps{}) != 76 {
		t.Fatal("incorrect MIDIINCAPSW ABI")
	}
	devices, err := (NativeDriver{}).List()
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("Windows MIDI Input devices: %d", len(devices))
	for _, device := range devices {
		t.Logf("%s: %s", device.ID, device.Name)
	}
}
