import React, { useEffect, useRef, useState } from "react";
import { info as product } from "../../wails.json";
import { createRoot } from "react-dom/client";
import {
  Renderer,
  Stave,
  StaveNote,
  Voice,
  Formatter,
  Accidental,
  Barline,
} from "vexflow";
import {
  Music2,
  X,
  Minus,
  Square,
  ChevronUp,
  ChevronDown,
  Keyboard,
  Check,
  RotateCcw,
  Monitor,
  Layers,
  ArrowUpDown,
  SlidersHorizontal,
  Settings as Gear,
  Download,
} from "lucide-react";
import {
  describe,
  octave,
  russianOctave,
  keyboardOctave,
  isBlack,
  matches,
  loadSettings,
  normalize,
  availableOctaves,
  virtualInstrument,
  notationFor,
  ledgerLines,
  type Settings,
  type NoteOn,
} from "./model";
import "./style.css";
import { SelectField } from "./SelectField";
import { useMidi, type MIDIEvent } from "./useMidi";
import { audio } from "./audio";
import { useAudio, AudioSettings, AudioNotices } from "./useAudio";
import { MIDIDeviceMenu } from "./MIDIDeviceMenu";
import { useCalibration } from "./useCalibration";
import { CalibrationWizard } from "./CalibrationWizard";
import { SettingsSection, useSettingsSections } from "./SettingsSection";
import { UpdatePanel, useUpdates } from "./updates";
import { profileRange } from "./calibration";
import {
  loadTraining,
  trainingNote,
  trainingPool,
  trainingSettings,
  type Training,
} from "./learning";

declare global {
  interface Window {
    runtime?: {
      WindowMinimise: () => void;
      WindowToggleMaximise: () => void;
      Quit: () => void;
    };
  }
}
function Staff({ note, settings }: { note: number; settings: Settings }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const draw = () => {
      const scoreWidth = Math.max(
        210,
        (el.clientWidth / Math.max(1, el.clientHeight)) * 110,
      );
      el.replaceChildren();
      const r = new Renderer(el, Renderer.Backends.SVG);
      r.resize(scoreWidth, 150);
      const c = r.getContext();
      c.setFillStyle("#f5f3ff");
      c.setStrokeStyle("#c4c1d8");
      const { clef, written } = notationFor(
        note,
        settings.clef,
        settings.spelling,
      );
      const stave = new Stave(12, 10, scoreWidth - 24);
      stave.setBegBarType(Barline.type.NONE).setEndBarType(Barline.type.NONE);
      stave.addClef(clef);
      stave.setContext(c).draw();
      const d = describe(written, settings.spelling);
      const n = new StaveNote({
        keys: [d.key],
        duration: "q",
        clef,
        auto_stem: true,
      });
      if (d.accidental) n.addModifier(new Accidental(d.accidental));
      n.setStyle({ fillStyle: "#faf9ff", strokeStyle: "#faf9ff" });
      n.setLedgerLineStyle({ strokeStyle: "#c4c1d8", lineWidth: 1 });
      const voice = new Voice({ num_beats: 1, beat_value: 4 }).addTickables([
        n,
      ]);
      new Formatter().joinVoices([voice]).format([voice], 120);
      // Move the complete tick (including accidental), not just the
      // notehead: StaveNote.setXShift does not move left-side modifiers in VF4.
      n.setStave(stave);
      const tick = n.getTickContext();
      tick.setX(
        tick.getX() +
          scoreWidth * 0.55 -
          n.getAbsoluteX() -
          n.getGlyphWidth() / 2,
      );
      voice.draw(c, stave);
      const svg = el.querySelector("svg")!;
      el.style.width = "100%";
      el.style.height = "";
      svg.style.width = "100%";
      svg.style.height = "100%";
      // Fit actual glyph bounds with padding, preserving one uniform scale.
      // Unlike the old 160-unit frame this does not waste half the staff's height.
      const box = svg.getBBox();
      const top = Math.min(22, box.y - 9);
      const bottom = Math.max(125, box.y + box.height + 9);
      svg.setAttribute("viewBox", `0 ${top} ${scoreWidth} ${bottom - top}`);
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      svg.dataset.clef = clef;
      svg.dataset.midi = String(note);
      svg.dataset.writtenMidi = String(written);
      svg.removeAttribute("width");
      svg.removeAttribute("height");
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(el);
    return () => observer.disconnect();
  }, [note, settings.clef, settings.spelling]);
  return (
    <div
      className="staff"
      ref={ref}
      role="img"
      aria-label={`Нотный стан: ${describe(note, settings.spelling).letter}, ${notationFor(note, settings.clef, settings.spelling).clef === "bass" ? "басовый" : "скрипичный"} ключ`}
    />
  );
}
function App() {
  const [custom, setS] = useState(() =>
    loadSettings({ minimum: 0, maximum: 127 }),
  );
  const [training, setTraining] = useState(loadTraining);
  const s = trainingSettings(custom, training);
  const [note, setNote] = useState(() => trainingNote(s, training));
  const [open, setOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const updates = useUpdates();
  const sections = useSettingsSections();
  const [keys, setKeys] = useState(true);
  const [keyLabels, setKeyLabels] = useState(() => {
    try {
      const stored = JSON.parse(
        localStorage.getItem("sonari.keyboard.labels.v1") ?? "true",
      );
      return typeof stored === "boolean" ? stored : true;
    } catch {
      return true;
    }
  });
  const [keyHint, setKeyHint] = useState(() => {
    try {
      return (
        JSON.parse(
          localStorage.getItem("sonari.keyboard.hint.v1") ?? "false",
        ) === true
      );
    } catch {
      return false;
    }
  });
  const [keyFeedback, setKeyFeedback] = useState<{
    note: number;
    correct: boolean;
  } | null>(null);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [feedback, setFeedback] = useState<"correct" | "wrong" | null>(null);
  const [pressed, setPressed] = useState<number | null>(null);
  const [keyOct, setKeyOct] = useState(() =>
    training.mode === "first" ? 4 : keyboardOctave(note, octave(note)),
  );
  const [saveError, setSaveError] = useState(false);
  const locked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const feedbackTask = useRef<{
    run: () => void;
    remaining: number;
    due: number;
  } | null>(null);
  const release = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const done = s.count > 0 && correct >= s.count && feedback !== "correct";
  const showLetter = s.letter || feedback === "correct";
  const showRussian = s.russian || feedback === "correct";
  const midi = useMidi(routeMidi, routeAudio, () => audio.allNotesOff("midi"));
  const calibration = useCalibration(midi.state);
  const sound = useAudio(midi.state, !!calibration.wizard);
  function routeAudio(event: MIDIEvent) {
    const key = `${event.channel}-${event.note}`;
    if (event.type === "noteoff" || event.velocity === 0)
      audio.noteOff("midi", key);
    else if (!calibration.wizard)
      audio.noteOn("midi", key, event.note, event.velocity);
  }
  function virtualDown(
    event: React.PointerEvent<HTMLButtonElement>,
    note: number,
  ) {
    if (event.button !== 0 || calibration.wizard) return;
    event.preventDefault();
    void audio.activate();
    audio.noteOn("virtual", String(event.pointerId), note, 100);
    noteOn({ note, velocity: 100, source: "virtual" });
  }
  function virtualUp(event: React.PointerEvent<HTMLButtonElement>) {
    audio.noteOff("virtual", String(event.pointerId));
  }
  function keyboardDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    note: number,
  ) {
    if (
      event.repeat ||
      ![" ", "Enter"].includes(event.key) ||
      calibration.wizard
    )
      return;
    event.preventDefault();
    void audio.activate();
    audio.noteOn("virtual", `key-${note}`, note, 100);
    noteOn({ note, velocity: 100, source: "virtual" });
  }
  const instrument = calibration.profile
    ? profileRange(calibration.profile)
    : virtualInstrument;
  const pianoBounds = {
    minimum: Math.min(virtualInstrument.minimum, instrument.minimum),
    maximum: Math.max(virtualInstrument.maximum, instrument.maximum),
  };
  const instrumentKey = `${instrument.minimum}:${instrument.maximum}`;
  const [readyInstrument, setReadyInstrument] = useState(instrumentKey);
  const rangeChanged = readyInstrument !== instrumentKey;
  const compatible = trainingPool(s, training, instrument).length > 0;
  useEffect(() => {
    if (readyInstrument === instrumentKey) return;
    setReadyInstrument(instrumentKey);
    restart();
  }, [instrumentKey]);
  useEffect(() => {
    const task = feedbackTask.current;
    if (!task) return;
    if (calibration.wizard) {
      clearTimeout(timer.current);
      task.remaining = Math.max(0, task.due - performance.now());
    } else scheduleFeedback(task.run, task.remaining);
  }, [!!calibration.wizard]);
  function routeMidi(event: NoteOn) {
    if (!calibration.route(event)) noteOn(event);
  }
  function scheduleFeedback(run: () => void, delay: number) {
    clearTimeout(timer.current);
    feedbackTask.current = {
      run,
      remaining: delay,
      due: performance.now() + delay,
    };
    timer.current = setTimeout(() => {
      feedbackTask.current = null;
      run();
    }, delay);
  }
  useEffect(() => {
    try {
      localStorage.setItem("sonari.keyboard.hint.v1", JSON.stringify(keyHint));
    } catch {
      setSaveError(true);
    }
  }, [keyHint]);
  useEffect(() => {
    try {
      localStorage.setItem("sonari.settings.v2", JSON.stringify(custom));
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }, [custom]);
  useEffect(() => {
    try {
      localStorage.setItem("sonari.training.v1", JSON.stringify(training));
    } catch {
      setSaveError(true);
    }
  }, [training]);
  useEffect(() => {
    try {
      localStorage.setItem(
        "sonari.keyboard.labels.v1",
        JSON.stringify(keyLabels),
      );
    } catch {
      setSaveError(true);
    }
  }, [keyLabels]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      clearTimeout(release.current);
    },
    [],
  );
  function restart(settings = s, target = training) {
    clearTimeout(timer.current);
    feedbackTask.current = null;
    locked.current = false;
    setFeedback(null);
    setCorrect(0);
    setWrong(0);
    setPressed(null);
    setKeyFeedback(null);
    clearTimeout(release.current);
    if (!trainingPool(settings, target, instrument).length) return;
    const next = trainingNote(settings, target, note, Math.random, instrument);
    setNote(next);
    setKeyOct((current) =>
      target.mode === "first" ? 4 : keyboardOctave(next, current, pianoBounds),
    );
  }
  function changeTraining(target: Training) {
    setTraining(target);
    const settings = trainingSettings(custom, target);
    restart(settings, target);
  }
  function update(p: Partial<Settings>) {
    if (p.octaves && !p.octaves.length) return;
    const requested = { ...custom, ...p };
    if (!requested.letter && !requested.russian && !requested.staff) return;
    const value = normalize(requested, { minimum: 0, maximum: 127 });
    setS(value);
    if (
      ["rangeMode", "octaves", "chromatic", "count", "exact"].some(
        (k) => k in p,
      )
    )
      restart(trainingSettings(value, training));
  }
  function noteOn(event: NoteOn) {
    if (calibration.wizard || rangeChanged || !compatible) return;
    if (
      event.velocity <= 0 ||
      !Number.isInteger(event.note) ||
      event.note < instrument.minimum ||
      event.note > instrument.maximum
    )
      return;
    setPressed(event.note);
    clearTimeout(release.current);
    release.current = setTimeout(() => setPressed(null), 160);
    if (locked.current || done) return;
    setKeyFeedback({
      note: event.note,
      correct: matches(event.note, note, s.exact, instrument),
    });
    if (matches(event.note, note, s.exact, instrument)) {
      locked.current = true;
      setCorrect((v) => v + 1);
      setFeedback("correct");
      clearTimeout(timer.current);
      scheduleFeedback(
        () => {
          const next = trainingNote(s, training, note, Math.random, instrument);
          setNote(next);
          setKeyOct((current) => keyboardOctave(next, current, pianoBounds));
          setKeyFeedback(null);
          setFeedback(null);
          locked.current = false;
        },
        !s.letter || !s.russian ? 1200 : 650,
      );
    } else {
      setWrong((v) => v + 1);
      setFeedback("wrong");
      clearTimeout(timer.current);
      scheduleFeedback(() => {
        setFeedback(null);
        setKeyFeedback(null);
      }, 700);
    }
  }
  const d = describe(note, s.spelling);
  const ledgerCount = ledgerLines(
    note,
    notationFor(note, s.clef, s.spelling).clef,
    s.spelling,
  );
  const white = Array.from(
    { length: 24 },
    (_, i) => 12 * (keyOct + 1) + i,
  ).filter(
    (m) => m >= pianoBounds.minimum && m <= pianoBounds.maximum && !isBlack(m),
  );
  const enabled = Number(s.letter) + Number(s.russian) + Number(s.staff);
  function keyClass(midi: number) {
    return [
      pressed === midi ? "pressed" : "",
      keyHint && compatible && !rangeChanged && !done && midi === note
        ? "hinted"
        : "",
      keyFeedback?.note === midi
        ? keyFeedback.correct
          ? "answer-correct"
          : "answer-wrong"
        : "",
    ].join(" ");
  }
  const toggle = (
    k: "letter" | "russian" | "staff" | "octaveName",
    label: string,
  ) => (
    <label className="toggle-row">
      {label}
      <button
        role="switch"
        aria-checked={s[k]}
        aria-label={label}
        disabled={k !== "octaveName" && s[k] && enabled === 1}
        className={"switch " + (s[k] ? "on" : "")}
        onClick={() => update({ [k]: !s[k] })}
      >
        <span />
      </button>
    </label>
  );
  return (
    <div
      className={`shell ${keys ? "keyboard-open" : "keyboard-closed"} ${open ? "settings-open" : ""}`}
    >
      <header>
        <div className="brand">
          <Music2 />
          <b>{product.productName}</b>
        </div>
        <div className="training-controls">
          <SelectField
            label="Тренировка"
            value={training.mode}
            options={[
              {
                value: "first",
                label: `Первые ноты · ${training.expanded ? 7 : 5} нот`,
              },
              { value: "custom", label: "Своя тренировка" },
            ]}
            onChange={(mode) =>
              changeTraining({ ...training, mode: mode as Training["mode"] })
            }
          />
          {training.mode === "first" &&
            (training.expanded ? (
              <button
                className="learning-action"
                title="Вся октава: начать с пяти нот"
                onClick={() => changeTraining({ ...training, expanded: false })}
              >
                Начать с пяти нот
              </button>
            ) : (
              <button
                className="learning-action"
                onClick={() => changeTraining({ ...training, expanded: true })}
              >
                + Добавить ноты
              </button>
            ))}
        </div>
        <div className="window-actions">
          {updates.notify && (
            <button
              className="update-badge"
              title="Обновления Find a Note"
              aria-label="Обновления Find a Note"
              onClick={() => {
                setOpen(true);
                setAboutOpen(true);
              }}
            >
              <Download size={17} />
            </button>
          )}
          <button title="Настройки" onClick={() => setOpen(!open)}>
            <Gear />
          </button>
          <button
            title="Свернуть"
            onClick={() => window.runtime?.WindowMinimise()}
          >
            <Minus />
          </button>
          <button
            title="Развернуть"
            onClick={() => window.runtime?.WindowToggleMaximise()}
          >
            <Square size={17} />
          </button>
          <button
            className="close"
            title="Закрыть"
            onClick={() => window.runtime?.Quit()}
          >
            <X />
          </button>
        </div>
      </header>
      <div className="workspace">
        <main>
          <div className="exercise">
            {!compatible || rangeChanged ? (
              <div className="range-unavailable" role="status">
                <Keyboard size={32} />
                <h1>
                  {rangeChanged
                    ? "Обновляем диапазон…"
                    : training.mode === "first"
                      ? "Учебный набор недоступен"
                      : "Выбранные ноты недоступны"}
                </h1>
                {!rangeChanged && (
                  <>
                    <p>
                      {training.mode === "first"
                        ? "Инструмент не содержит все ноты набора «Первые ноты». Выберите свою тренировку с доступными нотами или виртуальный ввод."
                        : "Выбранный диапазон не пересекается с доступными нотами инструмента. Исходные настройки сохранены."}
                    </p>
                    <button
                      className="primary"
                      onClick={() => {
                        const target = { ...training, mode: "custom" as const };
                        const value = normalize(
                          { ...custom, rangeMode: "full" },
                          instrument,
                        );
                        setS(value);
                        setTraining(target);
                        restart(value, target);
                      }}
                    >
                      Использовать доступный диапазон
                    </button>
                    <button onClick={() => midi.select(null)}>
                      Виртуальный ввод
                    </button>
                  </>
                )}
              </div>
            ) : done ? (
              <div className="completed">
                <div className="success-orb">
                  <Check size={38} />
                </div>
                <h1>Отличная работа!</h1>
                <p>Тренировка завершена</p>
                <div className="result">
                  {correct} верно <span>·</span> {wrong} ошибок
                </div>
                <button className="primary" onClick={() => restart()}>
                  <RotateCcw size={17} /> Ещё раз
                </button>
              </div>
            ) : (
              <>
                <div
                  className={`notation ${s.staff && ledgerCount > 4 ? "extended" : ""}`}
                  style={
                    { "--ledger-lines": ledgerCount } as React.CSSProperties
                  }
                >
                  {s.staff && <Staff note={note} settings={s} />}
                </div>
                <div className="note-names" key={note}>
                  {showLetter && (
                    <span className="letter">
                      {d.letter.replace("#", "♯").replace("b", "♭")}
                    </span>
                  )}
                  {showLetter && showRussian && <i />}
                  {showRussian && (
                    <div className="russian-name">
                      <span className="russian">{d.russian}</span>
                      {s.octaveName && (
                        <small className="octave-name">
                          {russianOctave(note)}
                        </small>
                      )}
                    </div>
                  )}
                </div>
                <div className="feedback-space" aria-live="polite">
                  {feedback ? (
                    <div className={"feedback " + feedback}>
                      {feedback === "correct" ? (
                        <>
                          <Check size={23} /> Верно!
                        </>
                      ) : (
                        <>Попробуй ещё раз</>
                      )}
                    </div>
                  ) : (
                    <span className="hint">
                      Нажми соответствующую клавишу на пианино
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </main>
        {open && (
          <aside>
            <div className="aside-heading">
              <h2>Настройки</h2>
              <button title="Закрыть настройки" onClick={() => setOpen(false)}>
                <X size={21} />
              </button>
            </div>
            <div className="settings-scroll">
              <AudioNotices sound={sound} />
              <SettingsSection title="Звук" {...sections.props("sound")}>
                <AudioSettings sound={sound} />
              </SettingsSection>
              <SettingsSection
                title="Отображение"
                icon={<Monitor />}
                {...sections.props("display")}
              >
                {toggle("letter", "Буквенное обозначение")}
                {toggle("russian", "Русское название")}
                {toggle("octaveName", "Название октавы")}
                {toggle("staff", "Нотный стан")}
              </SettingsSection>
              {training.mode === "custom" ? (
                <>
                  <SettingsSection
                    title="Диапазон"
                    icon={<ArrowUpDown />}
                    {...sections.props("range")}
                  >
                    <div
                      className="range-modes"
                      role="group"
                      aria-label="Диапазон заданий"
                    >
                      <button
                        aria-pressed={s.rangeMode === "octaves"}
                        onClick={() => update({ rangeMode: "octaves" })}
                      >
                        Выбранные октавы
                      </button>
                      <button
                        aria-pressed={s.rangeMode === "full"}
                        onClick={() => update({ rangeMode: "full" })}
                      >
                        Вся клавиатура
                      </button>
                    </div>
                    {s.rangeMode === "octaves" ? (
                      <div
                        className="octave-grid"
                        role="group"
                        aria-label="Октавы заданий"
                      >
                        {availableOctaves(instrument).map((o) => {
                          const minimum = Math.max(
                            instrument.minimum,
                            12 * (o + 1),
                          );
                          const maximum = Math.min(
                            instrument.maximum,
                            12 * (o + 2) - 1,
                          );
                          const selected = s.octaves.includes(o);
                          return (
                            <button
                              key={o}
                              aria-label={`${describe(minimum).letter}–${describe(maximum).letter}`}
                              aria-pressed={selected}
                              disabled={selected && s.octaves.length === 1}
                              onClick={() =>
                                update({
                                  octaves: selected
                                    ? s.octaves.filter((v) => v !== o)
                                    : [...s.octaves, o],
                                })
                              }
                            >
                              <strong>{o}</strong>
                              <span>
                                {describe(minimum).letter}–
                                {describe(maximum).letter}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="range-summary">
                        {describe(instrument.minimum).letter}–
                        {describe(instrument.maximum).letter}{" "}
                        <span>
                          · {instrument.maximum - instrument.minimum + 1} нот
                        </span>
                      </p>
                    )}
                    <SelectField
                      label="Клавиши"
                      value={s.chromatic ? "all" : "white"}
                      onChange={(v) => update({ chromatic: v === "all" })}
                      options={[
                        { value: "white", label: "Только белые" },
                        { value: "all", label: "Все клавиши" },
                      ]}
                    />
                    <SelectField
                      label="Альтерации"
                      value={s.spelling}
                      disabled={!s.chromatic}
                      onChange={(v) =>
                        update({ spelling: v as Settings["spelling"] })
                      }
                      options={[
                        { value: "sharp", label: "Диезы ♯" },
                        { value: "flat", label: "Бемоли ♭" },
                      ]}
                    />
                  </SettingsSection>
                  <SettingsSection
                    title="Нотация и проверка"
                    icon={<Layers />}
                    {...sections.props("notation")}
                  >
                    <SelectField
                      label="Ключ"
                      value={s.clef}
                      onChange={(v) => update({ clef: v as Settings["clef"] })}
                      options={[
                        { value: "auto", label: "Автоматически" },
                        { value: "treble", label: "Скрипичный" },
                        { value: "bass", label: "Басовый" },
                      ]}
                    />
                    <SelectField
                      label="Точность ответа"
                      value={s.exact ? "exact" : "octave"}
                      onChange={(v) => update({ exact: v === "exact" })}
                      options={[
                        { value: "exact", label: "Точная клавиша" },
                        { value: "octave", label: "Любая октава" },
                      ]}
                    />
                  </SettingsSection>
                </>
              ) : null}
              <SettingsSection
                title="Тренировка"
                icon={<SlidersHorizontal />}
                {...sections.props("training")}
              >
                {training.mode === "first" && (
                  <p
                    className="settings-note"
                    title="Только белые клавиши. Диапазон, ключ и точность ответа настраиваются в своей тренировке."
                  >
                    Первые ноты · Скрипичный ключ · C4–
                    {training.expanded ? "B4" : "G4"}
                  </p>
                )}
                <SelectField
                  label="Заданий"
                  value={String(s.count)}
                  onChange={(v) => update({ count: Number(v) })}
                  options={[
                    { value: "0", label: "Бесконечно" },
                    { value: "10", label: "10 нот" },
                    { value: "20", label: "20 нот" },
                    { value: "50", label: "50 нот" },
                  ]}
                />
                <p className="settings-note">
                  Изменение диапазона или точности ответа начинает новую серию.
                </p>
              </SettingsSection>
              {sections.saveError && (
                <p role="alert">Не удалось сохранить вид панели настроек.</p>
              )}
              {saveError && (
                <p role="alert">
                  Не удалось сохранить настройки на этом устройстве.
                </p>
              )}
              <details
                className="settings-section"
                open={aboutOpen}
                onToggle={(event) => setAboutOpen(event.currentTarget.open)}
              >
                <summary>О программе</summary>
                <p className="settings-note">
                  {product.productName} · Версия {product.productVersion}
                </p>
                <UpdatePanel update={updates} />
              </details>
            </div>
          </aside>
        )}
      </div>
      <div className={"piano-panel " + (!keys ? "collapsed" : "")}>
        <div className="piano-toolbar">
          <div className="piano-heading">
            <button
              className="keyboard-toggle"
              aria-expanded={keys}
              onClick={() => {
                audio.allNotesOff("virtual");
                setKeys(!keys);
              }}
            >
              <Keyboard size={17} /> Виртуальное пианино{" "}
              {keys ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
            </button>
            <button
              className="key-labels-toggle"
              aria-label="Подписи клавиш"
              aria-pressed={keyLabels}
              title={
                keyLabels ? "Скрыть подписи клавиш" : "Показать подписи клавиш"
              }
              onClick={() => setKeyLabels((value) => !value)}
            >
              <span aria-hidden="true">Aa</span>
              <span>Подписи</span>
            </button>
            <button
              className="key-labels-toggle"
              aria-label="Подсветка клавиш"
              aria-pressed={keyHint}
              onClick={() => setKeyHint((value) => !value)}
            >
              <span aria-hidden="true">✦</span>
              <span>Подсветка</span>
            </button>
          </div>
          {keys && (
            <div className="octaves">
              <span>
                {describe(white[0]).letter}–
                {describe(white[white.length - 1]).letter}
              </span>
            </div>
          )}
        </div>
        {keys && (
          <div className="piano-scroll">
            <div className="piano" style={{ minWidth: 560 }}>
              {white.map((m, i) => (
                <React.Fragment key={m}>
                  <button
                    aria-label={describe(m).letter}
                    data-midi={m}
                    className={"white-key " + keyClass(m)}
                    onPointerDown={(e) => virtualDown(e, m)}
                    onPointerUp={virtualUp}
                    onPointerLeave={virtualUp}
                    onPointerCancel={virtualUp}
                    onKeyDown={(e) => keyboardDown(e, m)}
                    onKeyUp={() => audio.noteOff("virtual", `key-${m}`)}
                    onBlur={() => audio.allNotesOff("virtual")}
                    onClick={(e) => {
                      if (e.detail === 0)
                        noteOn({ note: m, velocity: 100, source: "virtual" });
                    }}
                    style={{
                      left: `${(i / white.length) * 100}%`,
                      width: `${100 / white.length}%`,
                    }}
                  >
                    {keyLabels && (
                      <span className={m % 12 === 0 ? "tonic" : ""}>
                        {describe(m).letter}
                      </span>
                    )}
                  </button>
                  {isBlack(m + 1) && m + 1 <= pianoBounds.maximum && (
                    <button
                      aria-label={describe(m + 1).letter}
                      data-midi={m + 1}
                      className={"black-key " + keyClass(m + 1)}
                      onPointerDown={(e) => virtualDown(e, m + 1)}
                      onPointerUp={virtualUp}
                      onPointerLeave={virtualUp}
                      onPointerCancel={virtualUp}
                      onKeyDown={(e) => keyboardDown(e, m + 1)}
                      onKeyUp={() => audio.noteOff("virtual", `key-${m + 1}`)}
                      onBlur={() => audio.allNotesOff("virtual")}
                      onClick={(e) => {
                        if (e.detail === 0)
                          noteOn({
                            note: m + 1,
                            velocity: 100,
                            source: "virtual",
                          });
                      }}
                      style={{
                        left: `${((i + 0.68) / white.length) * 100}%`,
                        width: `${(0.64 / white.length) * 100}%`,
                      }}
                    >
                      {keyLabels && (
                        <span>
                          {describe(m + 1, s.spelling)
                            .letter.replace("#", "♯")
                            .replace("b", "♭")}
                        </span>
                      )}
                    </button>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        )}
      </div>
      <footer>
        <MIDIDeviceMenu midi={midi} calibration={calibration} sound={sound} />
        {sound.enabled && sound.status === "locked" && (
          <button onClick={() => void audio.activate()}>Включить звук</button>
        )}
        <div className="progress-area">
          <div className="progress-text">
            <span>Прогресс</span>
            <strong>
              {correct} / {s.count || "∞"}
            </strong>
          </div>
          {s.count > 0 && (
            <div
              className="progress-track"
              role="progressbar"
              aria-label="Прогресс тренировки"
              aria-valuemin={0}
              aria-valuemax={s.count}
              aria-valuenow={correct}
            >
              <div
                style={{
                  width: s.count
                    ? `${Math.min(100, (correct / s.count) * 100)}%`
                    : "0%",
                }}
              />
            </div>
          )}
          <small className="errors">Ошибки: {wrong}</small>
        </div>
        <button
          className={"settings-button " + (open ? "selected" : "")}
          onClick={() => setOpen(!open)}
        >
          <Gear size={20} />
          <span>Настройки</span>
          {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        <button
          className="reset"
          title="Начать заново"
          onClick={() => restart()}
        >
          <RotateCcw size={17} />
        </button>
      </footer>
      {calibration.wizard && (
        <CalibrationWizard
          calibration={calibration}
          connected={midi.state.status === "connected"}
        />
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
