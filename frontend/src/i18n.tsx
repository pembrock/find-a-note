import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import en from "./locales/en.json";
import ru from "./locales/ru.json";

export type Language = "en" | "ru";
export type MessageKey = keyof typeof en;
type Values = Record<string, string | number>;
type Translate = (key: MessageKey, values?: Values) => string;
const dictionaries: Record<Language, Record<MessageKey, string>> = { en, ru };
export const languageStorageKey = "sonari.language.v1";

function isLanguage(value: string | null): value is Language {
  return value === "ru" || value === "en";
}

export function resolveLanguage(
  saved: string | null,
  locale: string,
): Language {
  if (isLanguage(saved)) return saved;
  return locale.toLowerCase().split("-")[0] === "ru" ? "ru" : "en";
}

function initialLanguage(): Language {
  let saved = null;
  try {
    saved = localStorage.getItem(languageStorageKey);
  } catch {
    // A disabled profile still permits language selection for this session.
  }
  return resolveLanguage(saved, navigator.language);
}

export function translate(
  language: Language,
  key: MessageKey,
  values: Values = {},
) {
  return (dictionaries[language][key] ?? en[key] ?? "").replace(
    /\{([a-z]+)\}/gi,
    (_, name: string) => String(values[name] ?? ""),
  );
}

const LanguageContext = createContext<{
  language: Language;
  chooseLanguage: (value: string) => void;
  saveError: boolean;
  t: Translate;
} | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState(initialLanguage);
  const [saveError, setSaveError] = useState(false);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  function chooseLanguage(value: string) {
    if (!isLanguage(value)) return;
    setLanguage(value);
    try {
      localStorage.setItem(languageStorageKey, value);
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }

  return (
    <LanguageContext.Provider
      value={{
        language,
        chooseLanguage,
        saveError,
        t: (key, values) => translate(language, key, values),
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("LanguageProvider is missing");
  return context;
}

export function LanguageSelect() {
  const { t, language, chooseLanguage, saveError } = useLanguage();
  return (
    <div className="language-control">
      <label className="field">
        <span>{t("app-language")}</span>
        <select
          className="select-trigger"
          value={language}
          onChange={(event) => chooseLanguage(event.currentTarget.value)}
        >
          <option value="ru" lang="ru">
            Русский
          </option>
          <option value="en" lang="en">
            English
          </option>
        </select>
      </label>
      {saveError && <p role="alert">{t("language-save-error")}</p>}
    </div>
  );
}

export function localizedNotes(notes: string, language: Language) {
  const sections = /^English\n\n([\s\S]+?)\n\nРусский\n\n([\s\S]+)$/.exec(
    notes.trim().replace(/\r\n/g, "\n"),
  );
  if (!sections || !sections[1].trim() || !sections[2].trim()) return notes;
  return sections[language === "ru" ? 2 : 1].trim();
}

const syllables: Record<string, string> = {
  C: "Do",
  D: "Re",
  E: "Mi",
  F: "Fa",
  G: "Sol",
  A: "La",
  B: "Si",
};

export function solfege(letter: string) {
  const accidental = letter[1] === "#" ? "♯" : letter[1] === "b" ? "♭" : "";
  return syllables[letter[0]] + accidental;
}

export function midiMessage(t: Translate, value: string) {
  const [code, ...modifiers] = value.split(":");
  const key = Object.hasOwn(en, code) ? (code as MessageKey) : "midi-error";
  let message = t(key);
  if (modifiers.includes("reconnect"))
    message = t("midi-reconnect-auto", { message });
  if (modifiers.includes("release"))
    message = t("midi-release-error", { message });
  return message;
}
