import type { InstrumentRange } from "./model";
export type Profile = {
  identity: string;
  name: string;
  lowerMidiNote: number;
  upperMidiNote: number;
  confirmed: true;
};
export type CalibrationStore = {
  version: 1;
  profiles: Profile[];
  offered: string[];
};
export const calibrationKey = "sonari.midi.calibration.v1";
export function validBounds(lower: unknown, upper: unknown): boolean {
  return (
    typeof lower === "number" &&
    typeof upper === "number" &&
    Number.isInteger(lower) &&
    Number.isInteger(upper) &&
    lower >= 0 &&
    upper <= 127 &&
    lower < upper
  );
}
export function loadCalibration(): CalibrationStore {
  try {
    const raw = JSON.parse(localStorage.getItem(calibrationKey) ?? "null");
    if (raw?.version !== 1) throw new Error();
    const profiles = Array.isArray(raw.profiles)
      ? raw.profiles.filter(
          (p: any) =>
            p?.confirmed === true &&
            typeof p.identity === "string" &&
            p.identity.length > 0 &&
            typeof p.name === "string" &&
            validBounds(p.lowerMidiNote, p.upperMidiNote),
        )
      : [];
    return {
      version: 1,
      profiles: profiles.filter(
        (p: Profile, i: number) =>
          profiles.findIndex(
            (other: Profile) => other.identity === p.identity,
          ) === i,
      ),
      offered: Array.isArray(raw.offered)
        ? raw.offered.filter((s: unknown) => typeof s === "string")
        : [],
    };
  } catch {
    return { version: 1, profiles: [], offered: [] };
  }
}
export function profileRange(profile: Profile): InstrumentRange {
  return { minimum: profile.lowerMidiNote, maximum: profile.upperMidiNote };
}
