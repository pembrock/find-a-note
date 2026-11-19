import { useEffect, useRef } from "react";
import { Keyboard, ArrowLeft, ArrowRight, Check, Info } from "lucide-react";
import { describe } from "./model";
import type { useCalibration } from "./useCalibration";
export function CalibrationWizard({
  calibration,
  connected,
}: {
  calibration: ReturnType<typeof useCalibration>;
  connected: boolean;
}) {
  const { wizard: w, begin, save, cancel, ambiguous } = calibration;
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => previous?.focus();
  }, []);
  if (!w) return null;
  const step = w.stage === "prepare" ? 1 : w.stage === "confirm" ? 3 : 2;
  return (
    <div
      className="calibration-backdrop"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          cancel();
        }
        if (e.key === "Tab") {
          const buttons = [
            ...panel.current!.querySelectorAll<HTMLElement>(
              "button:not(:disabled)",
            ),
          ];
          const first = buttons[0],
            last = buttons[buttons.length - 1];
          if (
            e.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === panel.current)
          ) {
            e.preventDefault();
            last?.focus();
          } else if (
            !e.shiftKey &&
            (document.activeElement === last ||
              document.activeElement === panel.current)
          ) {
            e.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <div
        ref={panel}
        className="calibration-wizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calibration-title"
        tabIndex={-1}
      >
        <div className="calibration-steps" aria-label={`Этап ${step} из 3`}>
          {["Подготовка", "Определение диапазона", "Готово"].map((label, i) => (
            <div key={label} className={i + 1 <= step ? "active" : ""}>
              <b>{i + 1 < step ? <Check size={15} /> : i + 1}</b>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <div className="calibration-content">
          <Keyboard className="calibration-icon" size={42} />
          <h1 id="calibration-title">
            {w.stage === "prepare"
              ? "Настройка клавиатуры"
              : w.stage === "confirm"
                ? "Диапазон определён"
                : w.stage === "lost"
                  ? "Инструмент отключён"
                  : "Определи диапазон клавиатуры"}
          </h1>
          <p className="calibration-device">{w.device.name}</p>
          {w.stage === "prepare" ? (
            <>
              <p>
                Мы определим диапазон вашего инструмента.
                <br />
                Для этого понадобится нажать две клавиши.
              </p>
              <p className="calibration-explanation">
                Find a Note определяет фактически передаваемые MIDI-ноты, а не модель
                или число физических клавиш.
              </p>
            </>
          ) : w.stage === "confirm" ? (
            <>
              <div className="calibration-result">
                {describe(w.lower!).letter} <span>—</span>{" "}
                {describe(w.upper!).letter}
              </div>
              <p>
                MIDI {w.lower}–{w.upper} · Диапазон: {w.upper! - w.lower! + 1}{" "}
                нот
              </p>
              <p className="calibration-explanation">
                Непрерывный хроматический диапазон между двумя нажатиями.
                Остальные физические клавиши не проверялись.
              </p>
            </>
          ) : w.stage !== "lost" ? (
            <>
              <p>Нажми крайнюю левую и крайнюю правую клавиши на пианино.</p>
              <div className="calibration-cards" aria-live="polite">
                <div className={w.stage === "left" ? "active" : "complete"}>
                  <div>
                    <ArrowLeft />
                    <Keyboard />
                  </div>
                  <h2>
                    {w.lower === undefined
                      ? "Нажмите крайнюю левую клавишу"
                      : describe(w.lower).letter}
                  </h2>
                  <small>
                    {w.lower === undefined
                      ? "Определим самую низкую ноту"
                      : `Нижняя нота · MIDI ${w.lower}`}
                  </small>
                </div>
                <ArrowRight className="calibration-arrow" />
                <div className={w.stage === "right" ? "active" : ""}>
                  <div>
                    <Keyboard />
                    <ArrowRight />
                  </div>
                  <h2>Нажмите крайнюю правую клавишу</h2>
                  <small>Определим самую высокую ноту</small>
                </div>
              </div>
            </>
          ) : null}
          {w.error && (
            <p role="alert" className="calibration-error">
              {w.error}
            </p>
          )}
          {ambiguous && (
            <p className="calibration-explanation">
              Несколько одинаковых MIDI-входов: подтверждённый диапазон
              применяется только к этому соединению. Сохранённые профили не
              перезаписываются.
            </p>
          )}
        </div>
        <div className="calibration-footer">
          <p>
            <Info size={18} />
            <span>
              Перед настройкой отключите транспонирование и смещение октавы на
              инструменте.
            </span>
          </p>
          <div>
            <button onClick={cancel}>
              {w.stage === "prepare" ? "Позже" : "Отмена"}
            </button>
            {w.stage === "prepare" ? (
              <button className="primary" onClick={begin}>
                Начать <ArrowRight size={16} />
              </button>
            ) : w.stage === "confirm" ? (
              <>
                <button onClick={begin}>Определить заново</button>
                <button className="primary" onClick={save}>
                  Сохранить <Check size={16} />
                </button>
              </>
            ) : w.stage === "lost" ? (
              <button className="primary" disabled={!connected} onClick={begin}>
                Определить заново
              </button>
            ) : (
              <button onClick={begin}>Определить заново</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
