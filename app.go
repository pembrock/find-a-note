package main

import (
	"context"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"sonari/internal/midi"
)

type App struct{ midi *midi.Manager }

func (a *App) startup(ctx context.Context) {
	a.midi = midi.New(&midi.NativeDriver{}, func(name string, data any) { runtime.EventsEmit(ctx, name, data) })
}
func (a *App) shutdown(ctx context.Context) {
	if a.midi != nil {
		a.midi.Shutdown()
	}
}
func (a *App) GetMIDIState() midi.State         { return a.midi.State() }
func (a *App) RefreshMIDIDevices() midi.State   { return a.midi.Refresh() }
func (a *App) ConnectMIDI(id string) midi.State { return a.midi.Connect(id) }
func (a *App) DisconnectMIDI() midi.State       { return a.midi.Disconnect() }
