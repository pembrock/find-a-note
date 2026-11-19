import { useEffect, useRef, useState } from "react";
import { Keyboard, ChevronUp, ChevronDown, RotateCcw } from "lucide-react";
import { describe } from "./model";
import { useMidi } from "./useMidi";
import type { useCalibration } from "./useCalibration";

export function MIDIDeviceMenu({
  midi,
  calibration,
}: {
  midi: ReturnType<typeof useMidi>;
  calibration: ReturnType<typeof useCalibration>;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
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
    ? "Подключение…"
    : connected
      ? "Подключено (MIDI)"
      : state.status === "error"
        ? "MIDI недоступно"
        : state.devices.length
          ? "MIDI не подключено"
          : "MIDI-устройства не обнаружены";
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
        aria-label="Устройство ввода"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={`status-dot ${connected ? "midi-connected" : ""}`} />
        <span className="keyboard-icon">
          <Keyboard />
        </span>
        <span className="device-caption">
          <strong>{state.selected?.name ?? "Виртуальная клавиатура"}</strong>
          <small>{subtitle}</small>
        </span>
        {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>
      {open && (
        <section
          className="midi-menu"
          role="dialog"
          aria-label="Устройство ввода"
        >
          <h3>Устройство ввода</h3>
          <div
            className="midi-choices"
            role="group"
            aria-label="Источники ввода"
          >
            <button
              disabled={pending}
              aria-pressed={!connected}
              onClick={() => select(null)}
            >
              <span aria-hidden="true">{!connected ? "●" : "○"}</span>{" "}
              Виртуальная клавиатура
            </button>
            <p>Доступные MIDI-устройства</p>
            {!state.devices.length && (
              <small>MIDI-устройства не обнаружены</small>
            )}
            {state.devices.map((device, index) => (
              <button
                key={device.id}
                disabled={pending}
                aria-pressed={connected && state.selected?.id === device.id}
                onClick={() => select(device)}
              >
                <span aria-hidden="true">
                  {connected && state.selected?.id === device.id ? "●" : "○"}
                </span>{" "}
                <span>
                  {device.name}
                  {state.devices.filter((d) => d.identity === device.identity)
                    .length > 1
                    ? ` · порт ${index + 1}`
                    : ""}
                </span>
              </button>
            ))}
          </div>
          {state.message && (
            <p role="alert" className="midi-message">
              {state.message}
            </p>
          )}
          {warning && (
            <p role="status" className="midi-message">
              {warning}
            </p>
          )}
          {state.status === "error" && state.selected && (
            <button
              className="midi-retry"
              disabled={pending}
              onClick={() => select(state.selected)}
            >
              Повторить подключение
            </button>
          )}
          <button className="midi-refresh" disabled={pending} onClick={refresh}>
            <RotateCcw size={14} /> {pending ? "Подождите…" : "Обновить список"}
          </button>
          {connected && (
            <div className="device-calibration">
              {calibration.profile ? (
                <p>
                  Диапазон: {describe(calibration.profile.lowerMidiNote).letter}
                  –{describe(calibration.profile.upperMidiNote).letter}
                  <small>
                    MIDI: {calibration.profile.lowerMidiNote}–
                    {calibration.profile.upperMidiNote}
                  </small>
                </p>
              ) : (
                <p>Диапазон не определён</p>
              )}
              {calibration.ambiguous && (
                <small>
                  Одинаковые MIDI-входы: сохранённый диапазон не применяется
                  автоматически.
                </small>
              )}
              <button
                onClick={() => {
                  setOpen(false);
                  calibration.open();
                }}
              >
                {calibration.profile
                  ? "Определить заново"
                  : "Определить диапазон"}
              </button>
            </div>
          )}
          {connected && (
            <small className="midi-diagnostic" aria-live="polite">
              {last
                ? `Последняя нота: ${describe(last.note).letter} · MIDI ${last.note} · канал ${last.channel} · сила ${last.velocity}`
                : "Ожидаем нажатия на инструменте"}
            </small>
          )}
        </section>
      )}
    </div>
  );
}
