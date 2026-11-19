//go:build !windows && (!darwin || !cgo)

package midi

import "errors"

type NativeDriver struct{}

func (NativeDriver) List() ([]Device, error) { return []Device{}, nil }
func (NativeDriver) Open(Device, func(Packet)) (Input, error) {
	return nil, errors.New("MIDI-ввод поддерживается в Windows")
}
