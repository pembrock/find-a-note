import {
  nextNote,
  pool,
  virtualInstrument,
  type InstrumentRange,
  type Settings,
} from "./model";

export type Training = { mode: "first" | "custom"; expanded: boolean };
export const firstNotes = [60, 62, 64, 65, 67];
export function learningPool(expanded: boolean) {
  return expanded ? [...firstNotes, 69, 71] : [...firstNotes];
}
export function loadTraining(): Training {
  try {
    const raw = JSON.parse(
      localStorage.getItem("sonari.training.v1") ?? "null",
    );
    return {
      mode: raw?.mode === "custom" ? "custom" : "first",
      expanded: raw?.expanded === true,
    };
  } catch {
    return { mode: "first", expanded: false };
  }
}
export function trainingSettings(s: Settings, training: Training): Settings {
  return training.mode === "custom"
    ? s
    : {
        ...s,
        clef: "treble",
        exact: true,
        chromatic: false,
        spelling: "sharp",
      };
}
export function trainingNote(
  s: Settings,
  training: Training,
  previous?: number,
  random = Math.random,
  instrument: InstrumentRange = virtualInstrument,
) {
  if (training.mode === "custom")
    return nextNote(s, previous, random, instrument);
  if (!trainingPool(s, training, instrument).length)
    throw new Error("Learning set is outside the instrument range");
  const choices = learningPool(training.expanded).filter(
    (note) => note !== previous,
  );
  return choices[
    Math.min(choices.length - 1, Math.floor(random() * choices.length))
  ];
}
export function trainingPool(
  s: Settings,
  training: Training,
  instrument: InstrumentRange = virtualInstrument,
) {
  if (training.mode === "custom") return pool(s, instrument);
  const notes = learningPool(training.expanded);
  return notes.every(
    (note) => note >= instrument.minimum && note <= instrument.maximum,
  )
    ? notes
    : [];
}
