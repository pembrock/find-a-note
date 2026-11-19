import { type MessageKey } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { EventsOn } from "../wailsjs/runtime/runtime";
import type { NoteOn } from "./model";

export type MIDIDevice = { id: string; name: string; identity: string };
export type MIDIState = {
  devices: MIDIDevice[];
  selected: MIDIDevice | null;
  status: string;
  message: string;
  session: string;
  revision: number;
};
export type MIDIEvent = {
  session: string;
  type: "noteon" | "noteoff";
  note: number;
  velocity: number;
  channel: number;
};
type Backend = {
  GetMIDIState: () => Promise<MIDIState>;
  RefreshMIDIDevices: () => Promise<MIDIState>;
  ConnectMIDI: (id: string) => Promise<MIDIState>;
  DisconnectMIDI: () => Promise<MIDIState>;
};
declare global {
  interface Window {
    go?: { main: { App: Backend } };
  }
}
const initial: MIDIState = {
  devices: [],
  selected: null,
  status: "virtual",
  message: "",
  session: "0",
  revision: 0,
};
const preferenceKey = "sonari.midi.input.v1";

export function useMidi(
  onNote: (event: NoteOn) => void,
  onAudio: (event: MIDIEvent) => void,
  stopAudio: () => void,
) {
  const [state, setState] = useState(initial);
  const [pending, setPending] = useState(false);
  const [last, setLast] = useState<MIDIEvent | null>(null);
  const [warning, setWarning] = useState<MessageKey | "">("");
  const current = useRef(initial);
  const callback = useRef(onNote);
  callback.current = onNote;
  const audioCallback = useRef(onAudio);
  audioCallback.current = onAudio;
  const stop = useRef(stopAudio);
  stop.current = stopAudio;
  const alive = useRef(false);
  const busy = useRef(false);
  const switching = useRef(false);
  const desired = useRef<string | null>(null);
  const backend = window.go?.main?.App;
  function apply(next: MIDIState) {
    if (!alive.current || next.revision < current.current.revision) return;
    if (
      next.session !== current.current.session ||
      next.status !== "connected"
    ) {
      stop.current();
      setLast(null);
    }
    current.current = next;
    setState(next);
  }
  function bindingError() {
    stop.current();
    const next = {
      ...current.current,
      status: "error",
      message: "midi-bridge-error",
    };
    current.current = next;
    if (alive.current) setState(next);
  }
  useEffect(() => {
    alive.current = true;
    if (!backend)
      return () => {
        alive.current = false;
      };
    let active = true;
    async function restore(next: MIDIState) {
      if (
        !active ||
        busy.current ||
        next.revision < current.current.revision ||
        next.status !== "virtual" ||
        next.selected ||
        !desired.current
      )
        return;
      const matches = next.devices.filter(
        (d) => d.identity === desired.current,
      );
      if (matches.length !== 1) return;
      busy.current = true;
      switching.current = true;
      setPending(true);
      try {
        const restored = await backend!.ConnectMIDI(matches[0].id);
        if (active) apply(restored);
      } catch {
        if (active) bindingError();
      } finally {
        busy.current = false;
        switching.current = false;
        if (active) setPending(false);
      }
    }
    const offState = EventsOn("midi:state", (next: MIDIState) => {
      if (active) {
        apply(next);
        void restore(next);
      }
    });
    const offNote = EventsOn("midi:note", (event: MIDIEvent) => {
      if (
        !active ||
        switching.current ||
        current.current.status !== "connected" ||
        event.session !== current.current.session
      )
        return;
      if (
        (event.type !== "noteon" && event.type !== "noteoff") ||
        !Number.isInteger(event.note) ||
        event.note < 0 ||
        event.note > 127 ||
        !Number.isInteger(event.velocity) ||
        event.velocity < 0 ||
        event.velocity > 127 ||
        !Number.isInteger(event.channel) ||
        event.channel < 1 ||
        event.channel > 16
      )
        return;
      audioCallback.current(event);
      if (event.type !== "noteon" || event.velocity === 0) return;
      setLast(event);
      callback.current({
        note: event.note,
        velocity: event.velocity,
        source: "midi",
        session: event.session,
      });
    });
    backend
      .GetMIDIState()
      .then(async (next) => {
        if (!active || busy.current || next.revision < current.current.revision)
          return;
        apply(next);
        if (next.status === "connected") return;
        let preferred: unknown;
        try {
          preferred = JSON.parse(localStorage.getItem(preferenceKey) ?? "null");
        } catch {
          return;
        }
        if (typeof preferred !== "string") return;
        desired.current = preferred;
        const matches = next.devices.filter((d) => d.identity === preferred);
        if (matches.length === 1) {
          await restore(next);
        } else if (matches.length > 1) setWarning("midi-identical-devices");
      })
      .catch(() => {
        if (active) bindingError();
      });
    return () => {
      active = false;
      alive.current = false;
      offState();
      offNote();
      stop.current();
    };
  }, []);
  async function select(device: MIDIDevice | null) {
    if (!backend || busy.current) return;
    busy.current = true;
    desired.current = device?.identity || null;
    switching.current = true;
    stop.current();
    setPending(true);
    setLast(null);
    setWarning("");
    try {
      localStorage.setItem(
        preferenceKey,
        JSON.stringify(device?.identity || null),
      );
    } catch {
      setWarning("midi-selection-save-error");
    }
    try {
      apply(
        device
          ? await backend.ConnectMIDI(device.id)
          : await backend.DisconnectMIDI(),
      );
    } catch {
      bindingError();
    } finally {
      busy.current = false;
      switching.current = false;
      if (alive.current) setPending(false);
    }
  }
  async function refresh() {
    if (!backend || busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      apply(await backend.RefreshMIDIDevices());
    } catch {
      bindingError();
    } finally {
      busy.current = false;
      if (alive.current) setPending(false);
    }
  }
  return { state, pending, last, warning, select, refresh };
}
