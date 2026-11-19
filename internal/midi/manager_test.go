package midi

import (
	"errors"
	"sync"
	"testing"
	"time"
)

type fakeDriver struct {
	mu                                    sync.Mutex
	devices                               []Device
	inputs                                []*fakeInput
	openErr, startErr, closeErr, checkErr error
}
type fakeInput struct {
	driver          *fakeDriver
	sink            func(Packet)
	started, closed bool
}

func (d *fakeDriver) List() ([]Device, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]Device{}, d.devices...), nil
}
func (d *fakeDriver) Open(_ Device, sink func(Packet)) (Input, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.openErr != nil {
		return nil, d.openErr
	}
	input := &fakeInput{driver: d, sink: sink}
	d.inputs = append(d.inputs, input)
	return input, nil
}
func (i *fakeInput) Start() error {
	i.driver.mu.Lock()
	defer i.driver.mu.Unlock()
	i.started = true
	return i.driver.startErr
}
func (i *fakeInput) Close() error {
	i.driver.mu.Lock()
	defer i.driver.mu.Unlock()
	if i.driver.closeErr != nil {
		return i.driver.closeErr
	}
	i.closed = true
	return nil
}
func (i *fakeInput) Check() error {
	i.driver.mu.Lock()
	defer i.driver.mu.Unlock()
	return i.driver.checkErr
}
func (d *fakeDriver) input(index int) *fakeInput {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.inputs[index]
}
func (i *fakeInput) send(status, note, velocity uint32) {
	i.sink(Packet{Message: status | note<<8 | velocity<<16})
}
func setup(t *testing.T) (*Manager, *fakeDriver, chan Event) {
	t.Helper()
	d := &fakeDriver{devices: []Device{{"0|a", "Piano A", "a"}, {"1|b", "Piano B", "b"}}}
	events := make(chan Event, 100)
	m := New(d, func(name string, data any) {
		if name == "midi:note" {
			events <- data.(Event)
		}
	})
	t.Cleanup(m.Shutdown)
	return m, d, events
}
func receive(t *testing.T, events chan Event) Event {
	t.Helper()
	select {
	case e := <-events:
		return e
	case <-time.After(time.Second):
		t.Fatal("missing event")
		return Event{}
	}
}
func TestMessagesHeldKeysAndChannels(t *testing.T) {
	m, d, events := setup(t)
	state := m.Connect("0|a")
	if state.Status != "connected" {
		t.Fatal(state)
	}
	i := d.input(0)
	i.send(0x90, 60, 100)
	i.send(0x90, 60, 90)
	i.send(0x80, 60, 0)
	i.send(0x90, 60, 70)
	i.send(0x90, 60, 0)
	i.send(0x91, 60, 80)
	i.send(0x91, 60, 0)
	want := []Event{{state.Session, "noteon", 60, 100, 1}, {state.Session, "noteoff", 60, 0, 1}, {state.Session, "noteon", 60, 70, 1}, {state.Session, "noteoff", 60, 0, 1}, {state.Session, "noteon", 60, 80, 2}, {state.Session, "noteoff", 60, 0, 2}}
	for _, expected := range want {
		if actual := receive(t, events); actual != expected {
			t.Fatalf("got %+v want %+v", actual, expected)
		}
	}
	// Non-note messages and malformed data cannot create answers; the following
	// valid event is an ordering barrier for everything enqueued before it.
	i.send(0xb0, 64, 127)
	i.send(0xe0, 60, 100)
	i.send(0x90, 200, 100)
	i.send(0x90, 61, 200)
	i.send(0x70, 60, 100)
	i.send(0x90, 62, 100)
	if e := receive(t, events); e.Note != 62 || e.Type != "noteon" {
		t.Fatal(e)
	}
	i.send(0xb0, 123, 0)
	if e := receive(t, events); e.Note != 62 || e.Type != "noteoff" || e.Channel != 1 {
		t.Fatal(e)
	}
	i.send(0x90, 62, 90)
	if e := receive(t, events); e.Note != 62 || e.Velocity != 90 {
		t.Fatal(e)
	}
}
func TestSwitchDisconnectAndShutdownRejectStaleCallbacks(t *testing.T) {
	m, d, events := setup(t)
	first := m.Connect("0|a")
	old := d.input(0)
	second := m.Connect("1|b")
	current := d.input(1)
	if first.Session == second.Session || !old.closed || !current.started {
		t.Fatal("lifecycle not respected")
	}
	old.send(0x90, 60, 100)
	current.send(0x90, 62, 100)
	if e := receive(t, events); e.Note != 62 || e.Session != second.Session {
		t.Fatal(e)
	}
	state := m.Disconnect()
	if state.Status != "virtual" || !current.closed {
		t.Fatal(state)
	}
	current.send(0x90, 64, 100)
	third := m.Connect("0|a")
	d.input(2).send(0x90, 65, 100)
	if e := receive(t, events); e.Note != 65 || e.Session != third.Session {
		t.Fatal(e)
	}
	m.Shutdown()
	if !d.input(2).closed {
		t.Fatal("input leaked")
	}
	// The public API remains safe if React/Wails issues a late request.
	if m.Refresh().Status != "virtual" {
		t.Fatal("shutdown API")
	}
}
func TestUnavailableBusyAndStartFailure(t *testing.T) {
	m, d, _ := setup(t)
	if s := m.Connect("missing"); s.Status != "error" || s.Selected != nil {
		t.Fatal(s)
	}
	d.mu.Lock()
	d.openErr = errors.New("busy")
	d.mu.Unlock()
	if s := m.Connect("0|a"); s.Status != "error" || s.Selected.Name != "Piano A" {
		t.Fatal(s)
	}
	d.mu.Lock()
	d.openErr = nil
	d.startErr = errors.New("cannot start")
	d.mu.Unlock()
	if s := m.Connect("0|a"); s.Status != "error" {
		t.Fatal(s)
	}
	if !d.input(0).closed {
		t.Fatal("failed input not closed")
	}
	d.mu.Lock()
	d.startErr = nil
	d.mu.Unlock()
	if s := m.Connect("0|a"); s.Status != "connected" {
		t.Fatal(s)
	}
}
func TestDeviceRemovalAndDriverFailure(t *testing.T) {
	m, d, _ := setup(t)
	m.Connect("0|a")
	d.mu.Lock()
	d.devices = d.devices[1:]
	d.mu.Unlock()
	if s := m.Refresh(); s.Status != "error" || !d.input(0).closed {
		t.Fatal(s)
	}
	m.Connect("1|b")
	d.mu.Lock()
	d.checkErr = errors.New("gone")
	d.mu.Unlock()
	if s := m.Refresh(); s.Status != "error" || !d.input(1).closed {
		t.Fatal(s)
	}
	d.mu.Lock()
	d.checkErr = nil
	d.mu.Unlock()
	m.Connect("1|b")
	d.input(2).sink(Packet{Closed: true})
	// Actor processes the unsolicited CLOSE before reporting the error eventually.
	deadline := time.Now().Add(time.Second)
	for m.State().Status != "error" {
		if time.Now().After(deadline) {
			t.Fatal("close not detected")
		}
		time.Sleep(time.Millisecond)
	}
}
func TestCloseFailurePreventsOpeningAnotherPort(t *testing.T) {
	m, d, _ := setup(t)
	m.Connect("0|a")
	d.mu.Lock()
	d.closeErr = errors.New("cannot close")
	d.mu.Unlock()
	if s := m.Connect("1|b"); s.Status != "error" {
		t.Fatal(s)
	}
	d.mu.Lock()
	if len(d.inputs) != 1 {
		t.Fatal("two ports opened")
	}
	d.closeErr = nil
	d.mu.Unlock()
	if s := m.Connect("1|b"); s.Status != "connected" {
		t.Fatal(s)
	}
}

func TestHotplugReconnectsOnlyUniqueOriginalIdentity(t *testing.T) {
	m, d, events := setup(t)
	first := m.Connect("0|a")
	old := d.input(0)
	d.mu.Lock()
	d.devices = nil
	d.mu.Unlock()
	if s := m.Refresh(); s.Status != "error" {
		t.Fatal(s)
	}
	// A similarly named device must not be selected.
	d.mu.Lock()
	d.devices = []Device{{"7|other", "Piano A", "other"}}
	d.mu.Unlock()
	if s := m.Refresh(); s.Status != "error" {
		t.Fatal(s)
	}
	// Two exact identities require explicit selection.
	d.mu.Lock()
	d.devices = []Device{{"7|a", "Piano A", "a"}, {"8|a", "Piano A", "a"}}
	d.mu.Unlock()
	if s := m.Refresh(); s.Status != "error" {
		t.Fatal(s)
	}
	d.mu.Lock()
	d.devices = d.devices[:1]
	d.mu.Unlock()
	restored := m.Refresh()
	if restored.Status != "connected" || restored.Selected.ID != "7|a" || restored.Session == first.Session {
		t.Fatal(restored)
	}
	old.send(0x90, 60, 100)
	d.input(1).send(0x90, 62, 100)
	if e := receive(t, events); e.Note != 62 || e.Session != restored.Session {
		t.Fatal(e)
	}
	// An explicit virtual selection cancels a queued reconnect permanently.
	d.mu.Lock()
	d.devices = nil
	d.mu.Unlock()
	m.Refresh()
	m.Disconnect()
	d.mu.Lock()
	d.devices = []Device{{"7|a", "Piano A", "a"}}
	d.mu.Unlock()
	if s := m.Refresh(); s.Status != "virtual" {
		t.Fatal(s)
	}
}
