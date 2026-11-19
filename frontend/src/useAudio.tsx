import { useLanguage } from "./i18n";
import {
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { audio } from "./audio";
import type { MIDIState } from "./useMidi";

type Preferences = { volume: number; sources: Record<string, boolean> };
const storageKey = "sonari.audio.v1";
export function audioSource(state: MIDIState) {
  if (state.status !== "connected" || !state.selected) return "virtual";
  const ambiguous =
    state.devices.filter((d) => d.identity === state.selected!.identity)
      .length !== 1;
  return ambiguous
    ? `temporary-${state.session}-${state.selected.id}`
    : `device-${state.selected.identity}`;
}
function load(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (
      value &&
      typeof value.sources === "object" &&
      value.sources &&
      Number.isFinite(value.volume)
    )
      return {
        volume: Math.max(0, Math.min(100, value.volume)),
        sources: Object.fromEntries(
          Object.entries(value.sources).filter(
            ([, v]) => typeof v === "boolean",
          ),
        ) as Record<string, boolean>,
      };
  } catch {
    /* Defaults remain usable if storage is unavailable. */
  }
  return { volume: 70, sources: {} };
}
export function useAudio(state: MIDIState, calibrating: boolean) {
  const [preferences, setPreferences] = useState(load);
  const [saveError, setSaveError] = useState(false);
  const status = useSyncExternalStore(audio.subscribe, audio.snapshot);
  const source = audioSource(state);
  const enabled = preferences.sources[source] ?? true;
  useLayoutEffect(() => {
    audio.allNotesOff();
    audio.setEnabled("virtual", preferences.sources.virtual ?? true);
    audio.setEnabled(
      "midi",
      enabled && state.status === "connected" && !calibrating,
    );
    return () => audio.allNotesOff();
  }, [
    source,
    state.session,
    state.status,
    enabled,
    calibrating,
    preferences.sources.virtual,
  ]);
  useEffect(() => {
    audio.setVolume(preferences.volume);
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          ...preferences,
          sources: Object.fromEntries(
            Object.entries(preferences.sources).filter(
              ([key]) => !key.startsWith("temporary-"),
            ),
          ),
        }),
      );
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }, [preferences]);
  useEffect(() => {
    audio.init();
    const stop = () => audio.allNotesOff();
    const hide = () => {
      if (document.hidden) stop();
    };
    const dispose = () => audio.dispose();
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", dispose);
    return () => {
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", dispose);
      audio.dispose();
    };
  }, []);
  return {
    status,
    enabled,
    saveError,
    volume: preferences.volume,
    toggle: () => {
      const next = !enabled;
      audio.setEnabled(
        source === "virtual" ? "virtual" : "midi",
        next && !calibrating,
      );
      setPreferences((p) => ({
        ...p,
        sources: { ...p.sources, [source]: next },
      }));
      if (next) void audio.activate();
    },
    volumeChange: (volume: number) => {
      audio.setVolume(volume);
      setPreferences((p) => ({ ...p, volume }));
    },
  };
}

export function SoundToggle({
  sound,
  descriptionId,
}: {
  sound: Pick<ReturnType<typeof useAudio>, "enabled" | "toggle">;
  descriptionId?: string;
}) {
  const { t } = useLanguage();
  return (
    <div className="toggle-row">
      <span>{t("play-sound")}</span>
      <button
        type="button"
        role="switch"
        aria-label={t("play-sound")}
        aria-describedby={descriptionId}
        aria-checked={sound.enabled}
        className={"switch " + (sound.enabled ? "on" : "")}
        onClick={sound.toggle}
      >
        <span />
      </button>
    </div>
  );
}

export function AudioSettings({
  sound,
}: {
  sound: ReturnType<typeof useAudio>;
}) {
  const { t } = useLanguage();
  return (
    <>
      <SoundToggle sound={sound} />
      <label className="audio-volume">
        {t("volume")} <output>{sound.volume}%</output>
        <input
          aria-label={t("volume")}
          type="range"
          min="0"
          max="100"
          value={sound.volume}
          onChange={(e) => sound.volumeChange(Number(e.target.value))}
        />
      </label>
      {sound.status === "locked" && (
        <button className="primary" onClick={() => void audio.activate()}>
          {t("enable-sound")}
        </button>
      )}
      <details className="sound-info">
        <summary>{t("about-the-piano-sound")}</summary>
        <p>Salamander Grand Piano · Alexander Holm · CC BY 3.0</p>
        <a
          href="https://github.com/Tonejs/audio/tree/master/salamander"
          target="_blank"
          rel="noreferrer"
        >
          {t("sample-source")}
        </a>
        <p>{t("audio-source-preference")}</p>
      </details>
    </>
  );
}

export function AudioNotices({
  sound,
}: {
  sound: ReturnType<typeof useAudio>;
}) {
  const { t } = useLanguage();
  return (
    <>
      {sound.status === "loading" && (
        <p role="status" className="settings-note">
          {t("loading-piano-sounds")}
        </p>
      )}
      {sound.status === "error" && <p role="alert">{t("audio-load-error")}</p>}
      {sound.saveError && (
        <p role="alert">{t("could-not-save-sound-preferences")}</p>
      )}
    </>
  );
}
