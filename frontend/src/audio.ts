import * as Tone from "tone";

export type AudioStatus = "loading" | "ready" | "locked" | "error";
const sampleNames = [
  "A0",
  ...Array.from({ length: 7 }, (_, i) =>
    ["C", "Ds", "Fs", "A"].map((n) => `${n}${i + 1}`),
  ).flat(),
  "C8",
];

// One context and one decoded sample bank for the lifetime of the application.
export class AudioService {
  status: AudioStatus = "loading";
  private context?: Tone.Context;
  private sampler?: Tone.Sampler;
  private gain?: Tone.Gain;
  private voices = new Map<string, number>();
  private listeners = new Set<() => void>();
  private enabled = new Map<string, boolean>();
  private volume = 70;
  private disposed = false;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  snapshot = () => this.status;
  private publish(status: AudioStatus) {
    this.status = status;
    this.listeners.forEach((fn) => fn());
  }
  init() {
    if (this.context || this.disposed) return;
    try {
      this.context = new Tone.Context({
        latencyHint: "interactive",
        lookAhead: 0,
      });
      Tone.setContext(this.context);
      this.context.on("statechange", () => {
        if (this.status === "error" || !this.sampler?.loaded) return;
        if (this.context?.state !== "running") this.allNotesOff();
        this.publish(this.context?.state === "running" ? "ready" : "locked");
      });
      this.gain = new Tone.Gain((this.volume / 100) * 0.5).toDestination();
      const urls: Record<string, string> = {};
      for (const name of sampleNames) {
        urls[name.replace("s", "#")] = `/audio/salamander/${name}.mp3`;
      }
      if (Object.keys(urls).length < 30)
        throw new Error("Incomplete piano bank");
      this.sampler = new Tone.Sampler({
        urls,
        attack: 0,
        release: 0.65,
        onload: () => {
          if (!this.disposed)
            this.publish(
              this.context?.state === "running" ? "ready" : "locked",
            );
        },
        onerror: () => this.fail(),
      }).connect(this.gain);
    } catch {
      this.fail();
    }
  }
  async activate() {
    this.init();
    try {
      await this.context?.resume();
    } catch {
      this.fail();
    }
  }
  setEnabled(source: string, enabled: boolean) {
    if (!enabled) this.allNotesOff(source);
    this.enabled.set(source, enabled);
  }
  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(100, volume));
    this.gain?.gain.rampTo((this.volume / 100) * 0.5, 0.025);
  }
  noteOn(source: string, key: string, note: number, velocity: number) {
    if (
      !this.enabled.get(source) ||
      this.status !== "ready" ||
      !Number.isInteger(note) ||
      note < 21 ||
      note > 108 ||
      velocity < 1 ||
      velocity > 127
    )
      return;
    const token = `${source}:${key}`;
    if (this.voices.has(token)) return;
    try {
      this.sampler!.triggerAttack(
        Tone.Frequency(note, "midi").toFrequency(),
        this.context!.immediate(),
        Math.pow(velocity / 127, 1.4),
      );
      this.voices.set(token, note);
    } catch {
      this.fail();
    }
  }
  noteOff(source: string, key: string) {
    const token = `${source}:${key}`;
    const note = this.voices.get(token);
    this.voices.delete(token);
    if (note !== undefined && ![...this.voices.values()].includes(note)) {
      try {
        this.sampler?.triggerRelease(
          Tone.Frequency(note, "midi").toFrequency(),
          this.context!.immediate(),
        );
      } catch {
        this.fail();
      }
    }
  }
  allNotesOff(source?: string) {
    for (const token of [...this.voices.keys()]) {
      if (!source || token.startsWith(`${source}:`)) {
        const colon = token.indexOf(":");
        this.noteOff(token.slice(0, colon), token.slice(colon + 1));
      }
    }
  }
  private fail() {
    this.voices.clear();
    this.sampler?.dispose();
    this.sampler = undefined;
    this.publish("error");
  }
  dispose() {
    this.disposed = true;
    this.allNotesOff();
    this.sampler?.dispose();
    this.gain?.dispose();
    void this.context?.close();
    this.context?.dispose();
  }
}
export const audio = new AudioService();
