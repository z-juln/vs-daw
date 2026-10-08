import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SoundfontEngine } from "../src/audio/soundfontEngine";
import { FakeAudioContext } from "./fakeAudioContext";

type MockSynth = {
  noteOnCalls: Array<{ channel: number; note: number; velocity: number }>;
  noteOffCalls: Array<{ channel: number; note: number }>;
};

describe("Pad 实时多声部", () => {
  const sf2Path = join(tmpdir(), `vs-daw-live-pad-${process.pid}.sf2`);
  let ctx: FakeAudioContext;
  let engine: SoundfontEngine;

  beforeAll(() => {
    writeFileSync(sf2Path, Buffer.alloc(16));
  });

  afterAll(() => {
    try {
      unlinkSync(sf2Path);
    } catch {
      // ignore
    }
  });

  beforeEach(() => {
    ctx = new FakeAudioContext();
    engine = new SoundfontEngine(() => ctx, { sf2Path });
  });

  afterEach(() => {
    engine.dispose();
  });

  function liveSynth(): MockSynth {
    return (engine as unknown as { liveSynth: MockSynth }).liveSynth;
  }

  it("几乎同时的两个 noteOn 进入同一常驻 synth，且同一次 flush", async () => {
    await Promise.all([
      engine.noteOn(60, 100, 0, 0),
      engine.noteOn(64, 100, 0, 0),
    ]);
    await new Promise((r) => setTimeout(r, 30));

    const synth = liveSynth();
    expect(synth).toBeTruthy();
    expect(synth.noteOnCalls.map((c) => c.note).sort((a, b) => a - b)).toEqual([60, 64]);
    expect(ctx.started.length).toBeGreaterThan(0);
  });

  it("noteOff 会发给同一 synth", async () => {
    await engine.noteOn(67, 90, 0, 0);
    await new Promise((r) => setTimeout(r, 20));
    engine.noteOff(67, 0);
    await new Promise((r) => setTimeout(r, 20));

    expect(liveSynth().noteOffCalls.some((c) => c.note === 67)).toBe(true);
  });
});
