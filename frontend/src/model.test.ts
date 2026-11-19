import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaults,
  describe,
  matches,
  nextNote,
  normalize,
  pool,
  notationFor,
  octave,
  ledgerLines,
  russianOctave,
  keyboardOctave,
} from "./model";
import { Stave, StaveNote } from "vexflow";
import { validBounds } from "./calibration";
import { trainingNote, trainingPool } from "./learning";
test("calibration bounds and existing generators honour physical intersections without changing learning sets", () => {
  assert.ok(validBounds(0, 127));
  assert.ok(validBounds(21, 108));
  for (const [a, b] of [
    [21, 21],
    [108, 21],
    [-1, 108],
    [0, 128],
    [21.5, 108],
    [NaN, 90],
  ])
    assert.equal(validBounds(a, b), false);
  const settings = { ...defaults, octaves: [2, 4, 6] };
  assert.deepEqual(
    trainingPool(
      settings,
      { mode: "custom", expanded: false },
      { minimum: 55, maximum: 76 },
    ),
    [60, 62, 64, 65, 67, 69, 71],
  );
  assert.deepEqual(
    trainingPool(
      settings,
      { mode: "first", expanded: false },
      { minimum: 60, maximum: 67 },
    ),
    [60, 62, 64, 65, 67],
  );
  assert.deepEqual(
    trainingPool(
      settings,
      { mode: "first", expanded: true },
      { minimum: 60, maximum: 67 },
    ),
    [],
  );
  assert.deepEqual(
    trainingPool(
      settings,
      { mode: "custom", expanded: false },
      { minimum: 36, maximum: 47 },
    ),
    [36, 38, 40, 41, 43, 45, 47],
  );
  assert.deepEqual(
    trainingPool(
      { ...settings, octaves: [4] },
      { mode: "custom", expanded: false },
      { minimum: 36, maximum: 47 },
    ),
    [],
  );
  for (let i = 0; i < 100; i++) {
    const note = trainingNote(
      { ...settings, rangeMode: "full" },
      { mode: "custom", expanded: false },
      undefined,
      () => i / 100,
      { minimum: 55, maximum: 76 },
    );
    assert.ok(note >= 55 && note <= 76);
  }
  for (let note = 0; note <= 127; note++) {
    const start = keyboardOctave(note, 4, { minimum: 0, maximum: 127 });
    assert.ok(
      note >= 12 * (start + 1) && note <= Math.min(127, 12 * (start + 3) - 1),
    );
  }
});
test("Russian octave names and the nearest two-octave viewport cover all piano pitches", () => {
  const names = [
    "Субконтроктава",
    "Контроктава",
    "Большая октава",
    "Малая октава",
    "Первая октава",
    "Вторая октава",
    "Третья октава",
    "Четвёртая октава",
    "Пятая октава",
  ];
  for (let note = 21; note <= 108; note++) {
    assert.equal(russianOctave(note), names[octave(note)]);
    for (let current = 0; current <= 7; current++) {
      const next = keyboardOctave(note, current);
      const contains = (start: number) =>
        note >= Math.max(21, 12 * (start + 1)) &&
        note <= Math.min(108, 12 * (start + 3) - 1);
      assert.ok(contains(next));
      if (contains(current)) assert.equal(next, current);
      for (let candidate = 0; candidate <= 7; candidate++)
        if (contains(candidate))
          assert.ok(Math.abs(next - current) <= Math.abs(candidate - current));
    }
  }
  assert.equal(keyboardOctave(60, 4), 4);
  assert.equal(keyboardOctave(67, 4), 4);
  assert.equal(keyboardOctave(81, 3), 4);
  assert.equal(keyboardOctave(21, 4), 0);
  assert.equal(keyboardOctave(108, 4), 7);
  assert.equal(normalize({ version: 2 }).octaveName, true);
  assert.equal(normalize({ version: 2, octaveName: false }).octaveName, false);
  assert.equal(normalize({ version: 2, octaveName: "false" }).octaveName, true);
});
test("MIDI octaves, sharp and flat spellings", () => {
  assert.equal(describe(60).letter, "C4");
  assert.equal(describe(59).letter, "B3");
  assert.equal(describe(61).russian, "До диез");
  assert.equal(describe(61, "flat").letter, "Db4");
  assert.equal(describe(21).letter, "A0");
  assert.equal(describe(108).letter, "C8");
});
test("ranges and immediate repetitions", () => {
  const s = { ...defaults, octaves: [3, 4], chromatic: true };
  assert.deepEqual(pool(s, { minimum: 59, maximum: 61 }), [59, 60, 61]);
  for (let i = 0; i < 100; i++) assert.notEqual(nextNote(s, 60), 60);
  assert.equal(nextNote({ ...s, octaves: [8] }, 108), 108);
  assert.deepEqual(
    pool({ ...s, chromatic: false }, { minimum: 59, maximum: 61 }),
    [59, 60],
  );
});
test("octave matching and persisted settings validation", () => {
  assert.ok(matches(72, 60, false));
  assert.ok(!matches(72, 60, true));
  assert.ok(!matches(61, 60, false));
  assert.equal(
    normalize({ letter: false, russian: false, staff: false }).staff,
    true,
  );
  assert.deepEqual(normalize({ min: -5, max: 150 }).octaves, [4]);
  assert.equal(normalize({ count: "bad" }).count, 20);
});
test("disjoint octaves, incomplete edge octaves and independent instrument bounds", () => {
  const s = { ...defaults, octaves: [0, 2, 4, 8], chromatic: true };
  const notes = pool(s);
  assert.equal(notes.length, 28);
  assert.equal(notes[0], 21);
  assert.equal(notes.at(-1), 108);
  assert.ok(notes.every((m) => [0, 2, 4, 8].includes(octave(m))));
  assert.ok(!notes.includes(48));
  assert.equal(
    pool({ ...defaults, rangeMode: "full", chromatic: true }).length,
    88,
  );
  assert.equal(pool({ ...defaults, rangeMode: "full" }).length, 52);
  assert.ok(!matches(12, 60, false));
  assert.ok(!matches(120, 60, false));
  assert.ok(!matches(48, 60, false, { minimum: 60, maximum: 72 }));
  assert.ok(matches(72, 60, false, { minimum: 60, maximum: 72 }));
  assert.ok(!matches(NaN, 60, false));
  assert.ok(!matches(60.5, 60, true));
});
test("migration of all legacy presets and recovery of malformed or empty settings", () => {
  for (const [min, max, octaves] of [
    [48, 59, [3]],
    [60, 71, [4]],
    [72, 83, [5]],
    [48, 83, [3, 4, 5]],
  ] as const) {
    const s = normalize({ min, max });
    assert.deepEqual(s.octaves, octaves);
    assert.equal(s.rangeMode, "octaves");
  }
  assert.equal(normalize({ min: 21, max: 108 }).rangeMode, "full");
  assert.deepEqual(normalize({ min: 59, max: 61 }).octaves, [3, 4]);
  for (const raw of [
    null,
    [],
    { version: 2, octaves: [] },
    { version: 2, octaves: "4" },
    { version: 2, octaves: [null, 100, {}, 4, 4] },
    { count: "bad" },
    { version: 2, letter: false, russian: false, staff: false },
  ]) {
    const s = normalize(raw);
    assert.ok(pool(s).length);
    assert.ok(s.letter || s.russian || s.staff);
    assert.equal(s.version, 2);
    assert.ok(!("min" in s));
  }
  const tiny = { minimum: 61, maximum: 61 };
  assert.deepEqual(
    pool(normalize({ version: 2, octaves: [0], chromatic: false }, tiny), tiny),
    [61],
  );
  const partial = { minimum: 61, maximum: 62 };
  assert.deepEqual(
    pool(
      normalize({ version: 2, octaves: [0], chromatic: false }, partial),
      partial,
    ),
    [62],
  );
});
test("all 88 pitches roundtrip through both spellings and actual VexFlow staff coordinates", () => {
  const pitch: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };
  const staff = new Stave(0, 0, 300);
  const letters = "cdefgab";
  for (let midi = 21; midi <= 108; midi++)
    for (const spelling of ["sharp", "flat"] as const) {
      const d = describe(midi, spelling);
      const [, letter, acc, oct] = d.letter.match(/^([A-G])([#b]?)(\d)$/)!;
      assert.equal(
        (Number(oct) + 1) * 12 +
          pitch[letter] +
          (acc === "#" ? 1 : acc === "b" ? -1 : 0),
        midi,
      );
      for (const clef of ["treble", "bass", "auto"] as const) {
        const n = notationFor(midi, clef, spelling);
        assert.equal(n.written, midi);
        assert.ok(!("shift" in n) && !("ottava" in n));
        if (clef === "auto") {
          assert.equal(
            ledgerLines(midi, n.clef, spelling),
            Math.min(
              ledgerLines(midi, "bass", spelling),
              ledgerLines(midi, "treble", spelling),
            ),
          );
        } else assert.equal(n.clef, clef);
        const [l, o] = describe(n.written, spelling).key.split("/");
        const diatonic = Number(o) * 7 + letters.indexOf(l);
        const bottom = n.clef === "treble" ? 4 * 7 + 2 : 2 * 7 + 4;
        const note = new StaveNote({
          keys: [describe(n.written, spelling).key],
          duration: "q",
          clef: n.clef,
        }).setStave(staff);
        assert.equal(
          note.getYs()[0],
          staff.getYForLine(4) - (diatonic - bottom) * 5,
          `${midi} ${clef} ${spelling}`,
        );
      }
    }
  assert.equal(notationFor(21, "auto").written, 21);
  assert.equal(notationFor(108, "auto").written, 108);
});
test("D5 and C4 use actual ledger positions; automatic ties consistently prefer treble", () => {
  const stave = new Stave(0, 0, 300);
  for (const [midi, clef, line, count] of [
    [74, "treble", 1, 0],
    [74, "bass", -5, 5],
    [60, "treble", 5, 1],
    [60, "bass", -1, 1],
  ] as const) {
    const n = notationFor(midi, clef);
    const vex = new StaveNote({
      keys: [describe(n.written).key],
      duration: "q",
      clef: n.clef,
    }).setStave(stave);
    assert.equal(vex.getYs()[0], stave.getYForLine(line));
    assert.equal(ledgerLines(midi, clef), count);
  }
  assert.equal(notationFor(60, "auto").clef, "treble");
  assert.equal(notationFor(59, "auto").clef, "bass");
  assert.equal(ledgerLines(63, "treble", "sharp"), 0);
  assert.equal(describe(63, "flat").letter, "Eb4");
  assert.equal(ledgerLines(108, "bass"), 15);
  assert.equal(ledgerLines(21, "treble"), 12);
});
