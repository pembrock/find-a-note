//go:build darwin && cgo

package midi

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"testing"
	"time"
)

func TestDecodeUMP(t *testing.T) {
	for _, tc := range []struct {
		word, message uint32
	}{
		{0x23913c40, 0x403c91},
		{0x208f3c20, 0x203c8f},
		{0x20903c00, 0x003c90},
		{0x20b17800, 0x0078b1},
		{0x20b17b00, 0x007bb1},
		{0x40903c00, 0},
		{0x20b1407f, 0},
		{0x2090807f, 0},
	} {
		packet, ok := decodeUMP(tc.word)
		if packet.Message != tc.message || ok != (tc.message != 0) {
			t.Errorf("%08x: got %+v, %v", tc.word, packet, ok)
		}
	}
}

func TestCoreMIDIVirtualSource(t *testing.T) {
	fixture := os.Getenv("FIND_A_NOTE_MIDI_FIXTURE")
	if fixture == "" {
		t.Skip("set FIND_A_NOTE_MIDI_FIXTURE to the compiled testdata/source.c")
	}
	cmd := exec.Command(fixture)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { stdin.Close(); cmd.Wait() })
	replies := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			replies <- scanner.Text()
		}
		close(replies)
	}()
	send := func(command string) {
		t.Helper()
		if _, err := fmt.Fprintln(stdin, command); err != nil {
			t.Fatal(err)
		}
		select {
		case answer := <-replies:
			if answer != "OK" {
				t.Fatalf("%s: fixture replied %q", command, answer)
			}
		case <-time.After(3 * time.Second):
			t.Fatalf("%s: fixture timed out", command)
		}
	}
	wait := func(m *Manager, match func(State) bool) State {
		t.Helper()
		for deadline := time.Now().Add(4 * time.Second); time.Now().Before(deadline); {
			state := m.Refresh()
			if match(state) {
				return state
			}
			time.Sleep(25 * time.Millisecond)
		}
		t.Fatalf("unexpected state: %+v", m.State())
		return State{}
	}
	const identity = "coremidi:1702987654"
	events := make(chan Event, 32)
	m := New(&NativeDriver{}, func(name string, value any) {
		if name == "midi:note" {
			events <- value.(Event)
		}
	})
	t.Cleanup(m.Shutdown)
	send("open")
	var device Device
	wait(m, func(s State) bool {
		for _, d := range s.Devices {
			if d.Identity == identity {
				device = d
				return true
			}
		}
		return false
	})
	if device.Name != "Find a Note MAC-02 Test" {
		t.Fatal(device)
	}
	connected := m.Connect(device.ID)
	if connected.Status != "connected" {
		t.Fatal(connected)
	}
	checkNotes := func(session string) {
		t.Helper()
		send("play")
		for i, want := range []Event{
			{session, "noteon", 60, 100, 1}, {session, "noteon", 64, 82, 2},
			{session, "noteoff", 60, 32, 1}, {session, "noteoff", 64, 0, 2},
			{session, "noteon", 67, 96, 1},
		} {
			if got := receive(t, events); got != want {
				t.Fatalf("event %d: got %+v, want %+v", i, got, want)
			}
		}
	}
	checkNotes(connected.Session)
	send("close")
	wait(m, func(s State) bool { return s.Status == "error" && s.Session != connected.Session })
	send("open")
	reconnected := wait(m, func(s State) bool { return s.Status == "connected" })
	if reconnected.Selected.Identity != identity || reconnected.Session == connected.Session {
		t.Fatal(reconnected)
	}
	checkNotes(reconnected.Session)
	m.Disconnect()
	send("play")
	select {
	case event := <-events:
		t.Fatalf("event after disconnect: %+v", event)
	case <-time.After(100 * time.Millisecond):
	}
}
