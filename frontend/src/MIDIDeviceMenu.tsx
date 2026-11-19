import { midiMessage, useLanguage } from "./i18n";
import { useEffect, useId, useRef, useState } from "react";
import { Keyboard, ChevronUp, ChevronDown, RotateCcw } from "lucide-react";
import { describe } from "./model";
import { useMidi } from "./useMidi";
import type { useCalibration } from "./useCalibration";
import { SoundToggle, type useAudio } from "./useAudio";
import { audio } from "./audio";

export function MIDIDeviceMenu({
  midi,
  calibration,
  sound,
}: {
  midi: ReturnType<typeof useMidi>;
  calibration: ReturnType<typeof useCalibration>;
  sound: ReturnType<typeof useAudio>;
}) {
  const [open, setOpen] = useState(false);
  const soundDescription = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const { t } = useLanguage();
  const { state, pending, last, warning, select, refresh } = midi;
  useEffect(() => {
    if (!open) return;
    root.current
      ?.querySelector<HTMLButtonElement>(".midi-menu button")
      ?.focus();
    function outside(e: PointerEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    function escape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const connected = state.status === "connected";
  const subtitle = pending
    ? t("connecting")
    : connected
      ? t("connected-midi")
      : state.status === "error"
        ? t("midi-unavailable")
        : state.devices.length
          ? t("midi-disconnected")
          : t("no-midi-devices-found");
  return (
    <div
      className="midi-device-root"
      ref={root}
      onBlur={(e) => {
        if (
          e.relatedTarget &&
          !e.currentTarget.contains(e.relatedTarget as Node)
        )
          setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="device device-trigger"
        aria-label={t("input-device")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={`status-dot ${connected ? "midi-connected" : ""}`} />
        <span className="keyboard-icon">
          <Keyboard />
        </span>
        <span className="device-caption">
          <strong>{state.selected?.name ?? t("virtual-keyboard")}</strong>
          <small>{subtitle}</small>
        </span>
        {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>
      {open && (
        <section
          className="midi-menu"
          role="dialog"
          aria-label={t("input-device")}
        >
          <h3>{t("input-device")}</h3>
          <div
            className="midi-choices"
            role="group"
            aria-label={t("input-sources")}
          >
            <button
              disabled={pending}
              aria-pressed={!connected}
              onClick={() => select(null)}
            >
              <span aria-hidden="true">{!connected ? "●" : "○"}</span>{" "}
              {t("virtual-keyboard")}
            </button>
            <p>{t("available-midi-devices")}</p>
            {!state.devices.length && (
              <small>{t("no-midi-devices-found")}</small>
            )}
            {state.devices.map((device, index) => (
              <button
                key={device.id}
                disabled={pending}
                aria-pressed={connected && state.selected?.id === device.id}
                onClick={() => {
                  void audio.activate();
                  void select(device);
                }}
              >
                <span aria-hidden="true">
                  {connected && state.selected?.id === device.id ? "●" : "○"}
                </span>{" "}
                <span>
                  {device.name}
                  {state.devices.filter((d) => d.identity === device.identity)
                    .length > 1
                    ? ` · ${t("port-number", { number: index + 1 })}`
                    : ""}
                </span>
              </button>
            ))}
          </div>
          {connected && (
            <div className="midi-sound">
              <SoundToggle sound={sound} descriptionId={soundDescription} />
              <p id={soundDescription} className="settings-note">
                {t("midi-speaker-hint")}
              </p>
            </div>
          )}
          {state.message && (
            <p role="alert" className="midi-message">
              {midiMessage(t, state.message)}
            </p>
          )}
          {warning && (
            <p role="status" className="midi-message">
              {t(warning)}
            </p>
          )}
          {state.status === "error" && state.selected && (
            <button
              className="midi-retry"
              disabled={pending}
              onClick={() => select(state.selected)}
            >
              {t("reconnect")}
            </button>
          )}
          <button className="midi-refresh" disabled={pending} onClick={refresh}>
            <RotateCcw size={14} />{" "}
            {pending ? t("please-wait") : t("refresh-devices")}
          </button>
          {connected && (
            <div className="device-calibration">
              {calibration.profile ? (
                <p>
                  {t("calibrated-range", {
                    lower: describe(calibration.profile.lowerMidiNote).letter,
                    upper: describe(calibration.profile.upperMidiNote).letter,
                  })}
                  <small>
                    MIDI: {calibration.profile.lowerMidiNote}–
                    {calibration.profile.upperMidiNote}
                  </small>
                </p>
              ) : (
                <p>{t("range-not-calibrated")}</p>
              )}
              {calibration.ambiguous && (
                <small>{t("midi-range-ambiguous")}</small>
              )}
              <button
                onClick={() => {
                  setOpen(false);
                  calibration.open();
                }}
              >
                {calibration.profile ? t("recalibrate") : t("calibrate-range")}
              </button>
            </div>
          )}
          {connected && (
            <small className="midi-diagnostic" aria-live="polite">
              {last
                ? t("last-note", {
                    name: describe(last.note).letter,
                    note: last.note,
                    channel: last.channel,
                    velocity: last.velocity,
                  })
                : t("waiting-for-a-key-press")}
            </small>
          )}
        </section>
      )}
    </div>
  );
}
