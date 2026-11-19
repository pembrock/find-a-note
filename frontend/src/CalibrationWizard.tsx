import { LanguageSelect, useLanguage } from "./i18n";
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
  const { t } = useLanguage();
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
          const controls = [
            ...panel.current!.querySelectorAll<HTMLElement>(
              "button:not(:disabled), select:not(:disabled)",
            ),
          ];
          const first = controls[0],
            last = controls[controls.length - 1];
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
        <div
          className="calibration-steps"
          aria-label={t("step-count", { step })}
        >
          {[t("preparation"), t("range-calibration"), t("done")].map(
            (label, i) => (
              <div key={i} className={i + 1 <= step ? "active" : ""}>
                <b>{i + 1 < step ? <Check size={15} /> : i + 1}</b>
                <span>{label}</span>
              </div>
            ),
          )}
        </div>
        <div className="calibration-content">
          <Keyboard className="calibration-icon" size={42} />
          <h1 id="calibration-title">
            {w.stage === "prepare"
              ? t("keyboard-setup")
              : w.stage === "confirm"
                ? t("range-calibrated")
                : w.stage === "lost"
                  ? t("instrument-disconnected")
                  : t("calibrate-your-keyboard-range")}
          </h1>
          <p className="calibration-device">{w.device.name}</p>
          {w.stage === "prepare" ? (
            <>
              <p>
                {t("calibration-intro")}
                <br />
                {t("youll-need-to-press-two-keys")}
              </p>
              <p className="calibration-explanation">
                {t("calibration-midi-explainer")}
              </p>
            </>
          ) : w.stage === "confirm" ? (
            <>
              <div className="calibration-result">
                {describe(w.lower!).letter} <span>—</span>{" "}
                {describe(w.upper!).letter}
              </div>
              <p>
                {t("calibration-result", {
                  lower: w.lower!,
                  upper: w.upper!,
                  count: w.upper! - w.lower! + 1,
                })}
              </p>
              <p className="calibration-explanation">
                {t("calibration-result-explainer")}
              </p>
            </>
          ) : w.stage !== "lost" ? (
            <>
              <p>{t("calibration-press-extremes")}</p>
              <div className="calibration-cards" aria-live="polite">
                <div className={w.stage === "left" ? "active" : "complete"}>
                  <div>
                    <ArrowLeft />
                    <Keyboard />
                  </div>
                  <h2>
                    {w.lower === undefined
                      ? t("press-the-leftmost-key")
                      : describe(w.lower).letter}
                  </h2>
                  <small>
                    {w.lower === undefined
                      ? t("this-sets-the-lowest-note")
                      : t("lower-note", { note: w.lower! })}
                  </small>
                </div>
                <ArrowRight className="calibration-arrow" />
                <div className={w.stage === "right" ? "active" : ""}>
                  <div>
                    <Keyboard />
                    <ArrowRight />
                  </div>
                  <h2>{t("press-the-rightmost-key")}</h2>
                  <small>{t("this-sets-the-highest-note")}</small>
                </div>
              </div>
            </>
          ) : null}
          {w.error && (
            <p role="alert" className="calibration-error">
              {t(w.error)}
            </p>
          )}
          {ambiguous && (
            <p className="calibration-explanation">
              {t("calibration-ambiguous")}
            </p>
          )}
        </div>
        <div className="calibration-footer">
          <p>
            <Info size={18} />
            <span>{t("calibration-transposition-hint")}</span>
          </p>
          <div>
            <button onClick={cancel}>
              {w.stage === "prepare" ? t("later") : t("cancel")}
            </button>
            {w.stage === "prepare" ? (
              <button className="primary" onClick={begin}>
                {t("start")} <ArrowRight size={16} />
              </button>
            ) : w.stage === "confirm" ? (
              <>
                <button onClick={begin}>{t("recalibrate")}</button>
                <button className="primary" onClick={save}>
                  {t("save")} <Check size={16} />
                </button>
              </>
            ) : w.stage === "lost" ? (
              <button className="primary" disabled={!connected} onClick={begin}>
                {t("recalibrate")}
              </button>
            ) : (
              <button onClick={begin}>{t("recalibrate")}</button>
            )}
          </div>
        </div>
        <LanguageSelect />
      </div>
    </div>
  );
}
