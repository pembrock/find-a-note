import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import en from "./locales/en.json";
import ru from "./locales/ru.json";
import {
  localizedNotes,
  midiMessage,
  resolveLanguage,
  solfege,
  translate,
  type MessageKey,
} from "./i18n";

test("explicit language takes precedence over the local WebView language", () => {
  for (const [locale, expected] of [
    ["ru-RU", "ru"],
    ["RU", "ru"],
    ["en-US", "en"],
    ["en-GB", "en"],
    ["fr-FR", "en"],
    ["de-DE", "en"],
    ["", "en"],
  ])
    assert.equal(resolveLanguage(null, locale), expected);
  assert.equal(resolveLanguage("en", "ru-RU"), "en");
  assert.equal(resolveLanguage("ru", "en-US"), "ru");
  assert.equal(resolveLanguage("invalid", "ru-RU"), "ru");
});

test("catalogs have matching, populated, referenced keys and interpolation", () => {
  const keys = Object.keys(en) as MessageKey[];
  assert.deepEqual(keys.sort(), Object.keys(ru).sort());
  const src = new URL("./", import.meta.url);
  const source =
    readdirSync(src)
      .filter((name) => /\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts"))
      .map((name) => readFileSync(new URL(name, src), "utf8"))
      .join("\n") +
    readFileSync(new URL("../../internal/midi/manager.go", src), "utf8");
  const fields = (text: string) =>
    [...text.matchAll(/\{([a-z]+)\}/gi)].map(([, key]) => key).sort();
  for (const key of keys) {
    assert.ok(en[key].trim() && ru[key].trim(), key);
    assert.ok(source.includes(JSON.stringify(key)), `Unused key ${key}`);
    assert.deepEqual(fields(en[key]), fields(ru[key]), key);
    const values = Object.fromEntries(
      fields(en[key]).map((field) => [field, `[${field}]`]),
    );
    for (const lang of ["en", "ru"] as const) {
      const rendered = translate(lang, key, values);
      for (const value of Object.values(values))
        assert.ok(rendered.includes(value), key);
      assert.doesNotMatch(rendered, /\{[a-z]+\}/i);
    }
  }
});

test("bilingual signed notes select a section and legacy notes display verbatim", () => {
  const notes =
    "English\r\n\r\n- English changes\r\n\r\nРусский\r\n\r\n- Изменения";
  assert.equal(localizedNotes(notes, "en"), "- English changes");
  assert.equal(localizedNotes(notes, "ru"), "- Изменения");
  for (const legacy of [
    "Legacy notes",
    "Заметки старой версии",
    "English\n\nPartial",
  ]) {
    assert.equal(localizedNotes(legacy, "en"), legacy);
  }
  assert.equal(solfege("Db4"), "Re♭");
  assert.equal(solfege("C#4"), "Do♯");
});

test("MIDI messages and fallback are rendered in the current language", () => {
  assert.match(
    midiMessage(
      (key, values) => translate("en", key, values),
      "midi-port-closed:reconnect",
    ),
    /MIDI port closed.*reconnect/,
  );
  assert.match(
    midiMessage(
      (key, values) => translate("ru", key, values),
      "midi-port-closed:release",
    ),
    /MIDI-порт закрыт.*освободить MIDI-порт/,
  );
  assert.match(
    midiMessage((key, values) => translate("en", key, values), "unknown"),
    /^MIDI error/,
  );
});
