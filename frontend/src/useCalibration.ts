import { type MessageKey } from "./i18n";
import { useLayoutEffect, useRef, useState } from "react";
import {
  calibrationKey,
  loadCalibration,
  validBounds,
  type Profile,
  type CalibrationStore,
} from "./calibration";
import type { MIDIDevice, MIDIState } from "./useMidi";
import type { NoteOn } from "./model";
export type Wizard = {
  device: MIDIDevice;
  session: string;
  stage: "prepare" | "left" | "right" | "confirm" | "lost";
  lower?: number;
  upper?: number;
  error: MessageKey | "";
};
export function useCalibration(midi: MIDIState) {
  const [store, setStore] = useState(loadCalibration);
  const saved = useRef(store);
  saved.current = store;
  const [wizard, setWizard] = useState<Wizard | null>(null);
  const current = useRef<Wizard | null>(null);
  const [temporary, setTemporary] = useState<{
    session: string;
    profile: Profile;
  } | null>(null);
  function commit(value: Wizard | null) {
    current.current = value;
    setWizard(value);
  }
  function persist(value: CalibrationStore) {
    localStorage.setItem(calibrationKey, JSON.stringify(value));
    saved.current = value;
    setStore(value);
  }
  const connected = midi.status === "connected" && midi.selected;
  const ambiguous =
    !!connected &&
    midi.devices.filter((d) => d.identity === midi.selected!.identity)
      .length !== 1;
  const profile = connected
    ? temporary?.session === midi.session
      ? temporary.profile
      : !ambiguous
        ? store.profiles.find((p) => p.identity === midi.selected!.identity)
        : undefined
    : undefined;
  function open() {
    if (!connected) return;
    const value = {
      ...saved.current,
      offered: [
        ...new Set([...saved.current.offered, midi.selected!.identity]),
      ],
    };
    // Offering the optional wizard is remembered independently of confirmed bounds.
    try {
      persist(value);
    } catch {
      saved.current = value;
      setStore(value);
    }
    commit({
      device: midi.selected!,
      session: midi.session,
      stage: "prepare",
      error: "",
    });
  }
  useLayoutEffect(() => {
    const active = current.current;
    if (
      active &&
      (midi.status !== "connected" ||
        midi.session !== active.session ||
        midi.selected?.id !== active.device.id)
    ) {
      if (active.stage !== "lost")
        commit({
          ...active,
          stage: "lost",
          lower: undefined,
          upper: undefined,
          error: "calibration-connection-lost",
        });
      return;
    }
    if (
      connected &&
      !current.current &&
      !profile &&
      !saved.current.offered.includes(midi.selected!.identity)
    )
      open();
  }, [midi.status, midi.session, midi.selected?.id]);
  function route(event: NoteOn) {
    const active = current.current;
    if (!active) return false;
    if (
      event.source !== "midi" ||
      event.session !== active.session ||
      midi.status !== "connected" ||
      midi.session !== active.session ||
      !Number.isInteger(event.note) ||
      event.note < 0 ||
      event.note > 127 ||
      event.velocity <= 0
    )
      return true;
    if (active.stage === "left")
      commit({
        ...active,
        lower: event.note,
        upper: undefined,
        stage: "right",
        error: "",
      });
    else if (active.stage === "right") {
      if (!validBounds(active.lower, event.note))
        commit({
          ...active,
          error: "calibration-invalid-order",
        });
      else
        commit({ ...active, upper: event.note, stage: "confirm", error: "" });
    }
    return true;
  }
  function begin() {
    if (!connected || !current.current) return;
    commit({
      device: midi.selected!,
      session: midi.session,
      stage: "left",
      error: "",
    });
  }
  function save() {
    const active = current.current;
    if (
      !active ||
      active.stage !== "confirm" ||
      midi.status !== "connected" ||
      midi.session !== active.session ||
      !validBounds(active.lower, active.upper)
    )
      return;
    const value: Profile = {
      identity: active.device.identity,
      name: active.device.name,
      lowerMidiNote: active.lower!,
      upperMidiNote: active.upper!,
      confirmed: true,
    };
    if (ambiguous) {
      setTemporary({ session: active.session, profile: value });
      commit(null);
      return;
    }
    try {
      persist({
        ...saved.current,
        profiles: [
          ...saved.current.profiles.filter(
            (p) => p.identity !== value.identity,
          ),
          value,
        ],
      });
      commit(null);
    } catch {
      commit({
        ...active,
        error: "calibration-save-error",
      });
    }
  }
  return {
    wizard,
    profile,
    ambiguous,
    open,
    begin,
    save,
    cancel: () => commit(null),
    route,
  };
}
