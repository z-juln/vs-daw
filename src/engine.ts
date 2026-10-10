import {
  SoundfontEngine,
  type AudioContextLike,
  type SampleResolver,
} from "./audio/soundfontEngine";
import { Session, TimedNote } from "./types";

export type { AudioContextLike, SampleResolver };

/** Thin facade used by extension.ts. */
export class DawEngine {
  private readonly inner: SoundfontEngine;

  onTick?: (positionSec: number) => void;

  constructor(
    createContext: () => AudioContextLike,
    options: { sf2Path: string },
  ) {
    this.inner = new SoundfontEngine(createContext, options);
    this.inner.onTick = (value) => this.onTick?.(value);
  }

  get contextState(): string {
    return this.inner.contextState;
  }

  get positionSec(): number {
    return this.inner.positionSec;
  }

  get hasBuffer(): boolean {
    return this.inner.hasBuffer;
  }

  warmUp(): void {
    void this.inner.warmUp();
  }

  async loadSession(
    session: Session,
    notes: TimedNote[],
    durationSec: number,
    loop: boolean,
    resolveSample?: SampleResolver,
  ): Promise<void> {
    await this.inner.load(session, notes, durationSec, loop, resolveSample);
  }

  play(fromSec: number): void {
    this.inner.play(fromSec);
  }

  seek(sec: number): void {
    this.inner.seek(sec);
  }

  pause(): void {
    this.inner.pause();
  }

  stop(): void {
    this.inner.stop();
  }

  noteOn(note: number, velocity: number, channel: number, program: number): void {
    void this.inner.noteOn(note, velocity, channel, program);
  }

  noteOff(note: number, channel: number): void {
    this.inner.noteOff(note, channel);
  }

  dispose(): void {
    this.inner.dispose();
  }
}
