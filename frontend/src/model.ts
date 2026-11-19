export type Settings = {
  letter: boolean;
  russian: boolean;
  octaveName: boolean;
  staff: boolean;
  version: 2;
  rangeMode: "octaves" | "full";
  octaves: number[];
  clef: "auto" | "treble" | "bass";
  exact: boolean;
  chromatic: boolean;
  spelling: "sharp" | "flat";
  count: number;
};
export const defaults: Settings = {
  letter: true,
  russian: true,
  octaveName: true,
  staff: true,
  version: 2,
  rangeMode: "octaves",
  octaves: [4],
  clef: "auto",
  exact: true,
  chromatic: false,
  spelling: "sharp",
  count: 20,
};
const sharp = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const flat = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const ru: Record<string, string> = {
  C: "До",
  D: "Ре",
  E: "Ми",
  F: "Фа",
  G: "Соль",
  A: "Ля",
  B: "Си",
};
export const octave = (m: number) => Math.floor(m / 12) - 1;
export function russianOctave(m: number) {
  return (
    [
      "Субконтроктава",
      "Контроктава",
      "Большая октава",
      "Малая октава",
      "Первая октава",
      "Вторая октава",
      "Третья октава",
      "Четвёртая октава",
      "Пятая октава",
    ][octave(m)] ?? `Октава ${octave(m)}`
  );
}
// Keep the current two-octave viewport if possible; otherwise move the fewest octaves.
export function keyboardOctave(
  note: number,
  current: number,
  instrument = virtualInstrument,
) {
  return Math.max(
    octave(instrument.minimum),
    Math.min(
      Math.max(octave(instrument.minimum), octave(instrument.maximum) - 1),
      Math.max(octave(note) - 1, Math.min(current, octave(note))),
    ),
  );
}
export const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(m % 12);
export function describe(m: number, spelling: Settings["spelling"] = "sharp") {
  const name = (spelling === "sharp" ? sharp : flat)[m % 12];
  return {
    letter: name + octave(m),
    russian:
      ru[name[0]] +
      (name.length > 1 ? (name[1] === "#" ? " диез" : " бемоль") : ""),
    key: name[0].toLowerCase() + "/" + octave(m),
    accidental: name.slice(1),
  };
}
export type InstrumentRange = { minimum: number; maximum: number };
export const virtualInstrument: InstrumentRange = { minimum: 21, maximum: 108 };
export function availableOctaves(instrument = virtualInstrument) {
  return Array.from(
    { length: octave(instrument.maximum) - octave(instrument.minimum) + 1 },
    (_, i) => octave(instrument.minimum) + i,
  );
}
export function pool(s: Settings, instrument = virtualInstrument) {
  return Array.from(
    { length: instrument.maximum - instrument.minimum + 1 },
    (_, i) => instrument.minimum + i,
  ).filter(
    (m) =>
      (s.rangeMode === "full" || s.octaves.includes(octave(m))) &&
      (s.chromatic || !isBlack(m)),
  );
}
export function nextNote(
  s: Settings,
  previous?: number,
  random = Math.random,
  instrument = virtualInstrument,
) {
  const all = pool(s, instrument);
  if (!all.length) throw new Error("Exercise range has no playable notes");
  const choices = all.length > 1 ? all.filter((m) => m !== previous) : all;
  return choices[
    Math.min(choices.length - 1, Math.floor(random() * choices.length))
  ];
}
export function matches(
  input: number,
  target: number,
  exact: boolean,
  instrument = virtualInstrument,
) {
  if (
    !Number.isInteger(input) ||
    input < instrument.minimum ||
    input > instrument.maximum
  )
    return false;
  return exact ? input === target : input % 12 === target % 12;
}
export function normalize(
  raw: unknown,
  instrument = virtualInstrument,
): Settings {
  const data = (typeof raw === "object" && raw ? raw : {}) as Record<
    string,
    unknown
  >;
  const x = { ...defaults, ...data, version: 2 } as Settings;
  for (const k of [
    "letter",
    "russian",
    "octaveName",
    "staff",
    "exact",
    "chromatic",
  ] as const)
    x[k] = typeof x[k] === "boolean" ? x[k] : defaults[k];
  if (!x.letter && !x.russian && !x.staff) x.staff = true;
  const available = availableOctaves(instrument);
  if (data.version !== 2) {
    const min = data.min,
      max = data.max;
    if (
      typeof min === "number" &&
      typeof max === "number" &&
      Number.isInteger(min) &&
      Number.isInteger(max) &&
      min >= 0 &&
      max <= 127 &&
      min <= max
    ) {
      x.rangeMode =
        min <= instrument.minimum && max >= instrument.maximum
          ? "full"
          : "octaves";
      x.octaves = available.filter(
        (o) => 12 * (o + 1) <= max && 12 * (o + 2) - 1 >= min,
      );
    }
  }
  if (!["octaves", "full"].includes(x.rangeMode)) x.rangeMode = "octaves";
  x.octaves = Array.isArray(x.octaves)
    ? [
        ...new Set(
          x.octaves.filter((o) => Number.isInteger(o) && available.includes(o)),
        ),
      ].sort((a, b) => a - b)
    : [];
  if (!x.octaves.length) x.octaves = [available.includes(4) ? 4 : available[0]];
  if (!["auto", "treble", "bass"].includes(x.clef)) x.clef = "auto";
  if (!["sharp", "flat"].includes(x.spelling)) x.spelling = "sharp";
  if (![0, 10, 20, 50].includes(x.count)) x.count = 20;
  if (!pool(x, instrument).length) {
    // Even a future instrument with only a black note must have a nonempty pool.
    const playable = available.find(
      (o) => pool({ ...x, octaves: [o] }, instrument).length,
    );
    if (playable !== undefined) x.octaves = [playable];
    else x.chromatic = true;
  }
  // Whitelist the v2 schema; discard stale bounds and unknown properties.
  return Object.fromEntries(
    Object.keys(defaults).map((k) => [k, x[k as keyof Settings]]),
  ) as Settings;
}
export function loadSettings(instrument = virtualInstrument) {
  try {
    const data = JSON.parse(
      localStorage.getItem("sonari.settings.v2") ||
        localStorage.getItem("sonari.settings.v1") ||
        "{}",
    );
    return normalize(
      data,
      data?.version === 2 ? instrument : virtualInstrument,
    );
  } catch {
    return normalize({});
  }
}
// Physical and virtual input share the same exercise callback.
export type NoteOn = {
  session?: string;
  note: number;
  velocity: number;
  source: "virtual" | "midi";
};
export type GenerationMode = "random" | "adaptive";

// Count ledger lines in the chosen spelling, rather than semitone distance.
// Bottom/top staff lines are E4/F5 (treble) and G2/A3 (bass).
export function ledgerLines(
  note: number,
  clef: "treble" | "bass",
  spelling: Settings["spelling"] = "sharp",
) {
  const letter = describe(note, spelling).key[0];
  const position = octave(note) * 7 + "cdefgab".indexOf(letter);
  const bottom = clef === "treble" ? 30 : 18;
  const top = bottom + 8;
  return Math.floor(Math.max(bottom - position, position - top, 0) / 2);
}

// Training always teaches the actual written position: no octave displacement.
// Automatic clef minimises ledger lines; ties consistently prefer treble.
export function notationFor(
  note: number,
  clefSetting: Settings["clef"],
  spelling: Settings["spelling"] = "sharp",
) {
  const clef =
    clefSetting === "auto"
      ? ledgerLines(note, "bass", spelling) <
        ledgerLines(note, "treble", spelling)
        ? "bass"
        : "treble"
      : clefSetting;
  return { clef, written: note };
}
