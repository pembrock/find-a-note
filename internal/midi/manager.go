// Package midi owns MIDI input independently of the exercise model.
package midi

import (
	"errors"
	"fmt"
	"log"
	"strconv"
	"sync/atomic"
	"time"
)

type Device struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Identity string `json:"identity"`
}
type State struct {
	Devices  []Device `json:"devices"`
	Selected *Device  `json:"selected"`
	Status   string   `json:"status"`
	Message  string   `json:"message"`
	Session  string   `json:"session"`
	Revision uint64   `json:"revision"`
}
type Event struct {
	Session  string `json:"session"`
	Type     string `json:"type"`
	Note     int    `json:"note"`
	Velocity int    `json:"velocity"`
	Channel  int    `json:"channel"`
}
type Packet struct {
	Message uint32
	Closed  bool
}
type Input interface {
	Start() error
	Close() error
	Check() error
}
type Driver interface {
	List() ([]Device, error)
	Open(Device, func(Packet)) (Input, error)
}
type command struct {
	action, id string
	reply      chan State
}
type queued struct {
	generation uint64
	packet     Packet
}

// All driver operations and held-key state run on one goroutine. The native
// callback only enqueues data; it never calls WinMM or the Wails runtime.
type Manager struct {
	driver            Driver
	emit              func(string, any)
	requests          chan command
	packets           chan queued
	done              chan struct{}
	overflow          *atomic.Bool
	state             State
	generation        uint64
	input             Input
	held              [16][128]bool
	reconnectIdentity string
}

func New(driver Driver, emit func(string, any)) *Manager {
	m := &Manager{driver: driver, emit: emit, requests: make(chan command), packets: make(chan queued, 1024), done: make(chan struct{}), state: State{Devices: []Device{}, Status: "virtual", Session: "0"}}
	go m.run()
	return m
}
func (m *Manager) call(action, id string) State {
	c := command{action: action, id: id, reply: make(chan State, 1)}
	select {
	case m.requests <- c:
	case <-m.done:
		return State{Devices: []Device{}, Status: "virtual", Message: "midi-stopped"}
	}
	select {
	case s := <-c.reply:
		return s
	case <-m.done:
		return State{Devices: []Device{}, Status: "virtual"}
	}
}
func (m *Manager) State() State            { return m.call("state", "") }
func (m *Manager) Refresh() State          { return m.call("refresh", "") }
func (m *Manager) Connect(id string) State { return m.call("connect", id) }
func (m *Manager) Disconnect() State       { return m.call("disconnect", "") }
func (m *Manager) Shutdown()               { m.call("shutdown", ""); <-m.done }
func (m *Manager) publish() {
	m.state.Revision++
	if m.emit != nil {
		m.emit("midi:state", m.snapshot())
	}
}
func (m *Manager) snapshot() State {
	s := m.state
	s.Devices = append([]Device{}, s.Devices...)
	if s.Selected != nil {
		d := *s.Selected
		s.Selected = &d
	}
	return s
}
func (m *Manager) invalidate() {
	m.generation++
	m.state.Session = strconv.FormatUint(m.generation, 10)
	m.held = [16][128]bool{}
	m.overflow = &atomic.Bool{}
}
func (m *Manager) closeInput() error {
	m.invalidate() // Already queued and in-flight callbacks become obsolete first.
	if m.input != nil {
		if err := m.input.Close(); err != nil {
			return err
		}
		m.input = nil
	}
	return nil
}
func (m *Manager) fail(message string) {
	if err := m.closeInput(); err != nil {
		message += ":release"
	}
	m.state.Status = "error"
	m.state.Message = message
	m.publish()
}
func (m *Manager) lost(message string) {
	if m.state.Selected != nil {
		m.reconnectIdentity = m.state.Selected.Identity
	}
	m.fail(message + ":reconnect")
}
func (m *Manager) refresh() {
	devices, err := m.driver.List()
	if err != nil {
		if m.state.Status == "connected" {
			m.lost("midi-refresh-error")
		} else {
			log.Printf("MIDI refresh-error: %v", err)
			m.fail("midi-refresh-error")
		}
		return
	}
	if devices == nil {
		devices = []Device{}
	}
	m.state.Devices = devices
	if m.state.Status == "connected" && m.state.Selected != nil {
		found := false
		for _, d := range devices {
			if d == *m.state.Selected {
				found = true
			}
		}
		if !found {
			m.lost("midi-device-removed")
			return
		}
		if err := m.input.Check(); err != nil {
			m.lost("midi-connection-lost")
			return
		}
	}
	if m.reconnectIdentity != "" && m.state.Status != "connected" {
		identity := m.reconnectIdentity
		matches := []Device{}
		for _, d := range devices {
			if d.Identity == identity {
				matches = append(matches, d)
			}
		}
		if len(matches) == 1 {
			m.connect(matches[0].ID)
			if m.state.Status == "connected" {
				m.reconnectIdentity = ""
			}
			return
		}
		if len(matches) > 1 {
			m.state.Message = "midi-identical-devices"
		}
	}
	m.publish()
}
func (m *Manager) connect(id string) {
	if err := m.closeInput(); err != nil {
		m.state.Status = "error"
		m.state.Message = "midi-close-previous"
		m.publish()
		return
	}
	m.state.Status = "virtual"
	m.state.Message = ""
	m.state.Selected = nil
	devices, err := m.driver.List()
	if err != nil {
		log.Printf("MIDI list-error: %v", err)
		m.fail("midi-list-error")
		return
	}
	m.state.Devices = append([]Device{}, devices...)
	var chosen *Device
	for _, d := range devices {
		if d.ID == id {
			copy := d
			chosen = &copy
			break
		}
	}
	if chosen == nil {
		m.fail("midi-device-unavailable")
		return
	}
	m.state.Selected = chosen
	generation := m.generation
	overflow := m.overflow
	input, err := m.driver.Open(*chosen, func(p Packet) {
		select {
		case m.packets <- queued{generation, p}:
		default:
			overflow.Store(true)
		}
	})
	if err != nil {
		log.Printf("MIDI connect-error: %v", err)
		code := "midi-connect-error"
		if errors.Is(err, errPortBusy) {
			code = "midi-port-busy"
		}
		m.fail(code)
		return
	}
	m.input = input
	if err = input.Start(); err != nil {
		log.Printf("MIDI start-error: %v", err)
		m.fail("midi-start-error")
		return
	}
	m.state.Status = "connected"
	m.state.Message = ""
	m.publish()
}
func (m *Manager) process(q queued) {
	if q.generation != m.generation || m.state.Status != "connected" {
		return
	}
	if q.packet.Closed {
		m.lost("midi-port-closed")
		return
	}
	b := q.packet.Message
	status := int(b & 255)
	channel := status & 15
	kind := status & 240
	note := int((b >> 8) & 255)
	velocity := int((b >> 16) & 255)
	if status < 128 || status >= 240 || note > 127 || velocity > 127 {
		return
	}
	if kind == 0xb0 && (note == 120 || note == 123) {
		for n, held := range m.held[channel] {
			if held && m.emit != nil {
				m.emit("midi:note", Event{Session: m.state.Session, Type: "noteoff", Note: n, Channel: channel + 1})
			}
		}
		m.held[channel] = [128]bool{}
		return
	}
	event := Event{Session: m.state.Session, Note: note, Velocity: velocity, Channel: channel + 1}
	switch {
	case kind == 0x80 || kind == 0x90 && velocity == 0:
		m.held[channel][note] = false
		event.Type = "noteoff"
	case kind == 0x90:
		if m.held[channel][note] {
			return
		}
		m.held[channel][note] = true
		event.Type = "noteon"
	default:
		return
	}
	if m.emit != nil {
		m.emit("midi:note", event)
	}
}
func (m *Manager) run() {
	defer close(m.done)
	if driver, ok := m.driver.(interface{ Close() error }); ok {
		defer func() {
			if err := driver.Close(); err != nil {
				log.Printf("MIDI driver shutdown: %v", err)
			}
		}()
	}
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	m.refresh()
	for {
		select {
		case c := <-m.requests:
			switch c.action {
			case "refresh":
				m.refresh()
			case "connect":
				m.reconnectIdentity = ""
				m.connect(c.id)
			case "disconnect", "shutdown":
				m.reconnectIdentity = ""
				if err := m.closeInput(); err != nil {
					m.state.Status = "error"
					m.state.Message = "midi-close-error"
				} else {
					m.state.Status = "virtual"
					m.state.Message = ""
					m.state.Selected = nil
				}
				m.publish()
			}
			c.reply <- m.snapshot()
			if c.action == "shutdown" {
				return
			}
		case q := <-m.packets:
			if m.overflow.Swap(false) {
				m.fail("midi-overload")
			} else {
				m.process(q)
			}
		case <-ticker.C:
			m.refresh()
		}
	}
}

var errPortBusy = errors.New("порт занят другим приложением")

func resultError(code uintptr) error {
	if code == 0 {
		return nil
	}
	switch code {
	case 4:
		return errPortBusy
	case 2, 5, 6:
		return errors.New("устройство или драйвер недоступны")
	default:
		return fmt.Errorf("ошибка Windows MIDI (%d)", code)
	}
}
