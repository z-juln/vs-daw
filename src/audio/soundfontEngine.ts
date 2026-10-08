import { readFileSync } from "fs";
import {
  BasicMIDI,
  SoundBankLoader,
  SpessaSynthProcessor,
  SpessaSynthSequencer,
  SPESSA_BUFSIZE,
} from "spessasynth_core";
import { encodeMidi } from "../midi/encode";
import { Session, TimedNote } from "../types";

export interface AudioContextLike {
  currentTime: number;
  sampleRate: number;
  state: string;
  destination: unknown;
  createBufferSource(): any;
  createGain(): any;
  createWaveShaper(): any;
  createBuffer(channels: number, length: number, sampleRate: number): any;
  resume(): Promise<void>;
  close(): Promise<void>;
}

export interface SoundfontEngineOptions {
  sf2Path: string;
  sampleRate?: number;
  masterGain?: number;
}

const SATURATION_DRIVE = 1.5;
const CEILING = 0.95;
/** Pad 实时渲染块长（秒）。 */
const LIVE_QUANTUM_SEC = 0.02;
/** 相对 AudioContext 时钟的预渲 look-ahead。 */
const LIVE_LOOKAHEAD_SEC = 0.08;
/** 距上次 Pad 活动多久后停泵（给 release 留尾巴）。 */
const LIVE_IDLE_MS = 2500;
const LIVE_PUMP_INTERVAL_MS = 10;

function saturationCurve(points = 1024): Float32Array {
  const curve = new Float32Array(points);
  const normalize = Math.tanh(SATURATION_DRIVE);
  for (let i = 0; i < points; i += 1) {
    const x = (i / (points - 1)) * 2 - 1;
    curve[i] = (Math.tanh(x * SATURATION_DRIVE) / normalize) * CEILING;
  }
  return curve;
}

function padHoldSec(channel: number, program: number): number {
  if (channel === 9) return 0.2;
  if (program >= 32 && program <= 39) return 1.0;
  return 0.8;
}

async function renderMidiPcm(
  midiBytes: Uint8Array,
  sf2Path: string,
  sampleRate: number,
  tailSec = 1,
): Promise<{ left: Float32Array; right: Float32Array }> {
  const midiCopy = midiBytes.buffer.slice(
    midiBytes.byteOffset,
    midiBytes.byteOffset + midiBytes.byteLength,
  );
  const midi = BasicMIDI.fromArrayBuffer(midiCopy as ArrayBuffer);
  const sfBytes = readFileSync(sf2Path);
  const soundBank = SoundBankLoader.fromArrayBuffer(
    sfBytes.buffer.slice(sfBytes.byteOffset, sfBytes.byteOffset + sfBytes.byteLength) as ArrayBuffer,
  );
  const synth = new SpessaSynthProcessor(sampleRate, { eventsEnabled: false });
  synth.soundBankManager.addSoundBank(soundBank, "main");
  await synth.processorInitialized;
  synth.setSystemParameter("autoAllocateVoices", true);
  const seq = new SpessaSynthSequencer(synth);
  seq.loadNewSongList([midi]);
  seq.play();
  const sampleCount = Math.max(sampleRate, Math.ceil(sampleRate * (midi.duration + tailSec)));
  const left = new Float32Array(sampleCount);
  const right = new Float32Array(sampleCount);
  let filled = 0;
  while (filled < sampleCount) {
    seq.processTick();
    const size = Math.min(SPESSA_BUFSIZE, sampleCount - filled);
    synth.process(left, right, filled, size);
    filled += size;
  }
  return { left, right };
}

export class SoundfontEngine {
  private ctx?: AudioContextLike;

  private master?: any;

  private source?: any;

  private ready: Promise<void> | undefined;

  private pcm?: { left: Float32Array; right: Float32Array };

  /** 缓存 WebAudio buffer，避免暂停后再次 play 时整曲 copyToChannel。 */
  private audioBuffer?: any;

  private durationSec = 0;

  private loop = true;

  private playing = false;

  private startedAt = 0;

  private offsetSec = 0;

  private readonly sampleRate: number;

  private readonly masterGain: number;

  onTick?: (positionSec: number) => void;

  private tickTimer?: ReturnType<typeof setInterval>;

  /** Pad 实时多声部：常驻 synth + MIDI 队列 + 分块 BufferSource 泵。 */
  private liveSynth?: SpessaSynthProcessor;

  private liveInit?: Promise<void>;

  private midiQueue: Array<() => void> = [];

  private channelProgram = new Map<number, number>();

  private autoOffTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private livePumpTimer?: ReturnType<typeof setInterval>;

  private nextLiveTime = 0;

  private lastLiveActivityMs = 0;

  constructor(
    private readonly createContext: () => AudioContextLike,
    private readonly options: SoundfontEngineOptions,
  ) {
    this.sampleRate = options.sampleRate ?? 44100;
    this.masterGain = options.masterGain ?? 0.6;
  }

  get contextState(): string {
    return this.ctx?.state ?? "closed";
  }

  get positionSec(): number {
    if (!this.playing || !this.ctx) return this.offsetSec;
    const raw = this.offsetSec + (this.ctx.currentTime - this.startedAt);
    if (this.loop && this.durationSec > 0) {
      return ((raw % this.durationSec) + this.durationSec) % this.durationSec;
    }
    return Math.min(raw, this.durationSec);
  }

  async warmUp(): Promise<void> {
    this.ensureContext();
    this.ready ??= this.preload();
    await this.ready;
    await this.ensureLiveSynth();
  }

  private async preload(): Promise<void> {
    // Touch SF2 once so first play is faster.
    readFileSync(this.options.sf2Path);
  }

  get hasBuffer(): boolean {
    return Boolean(this.pcm);
  }

  async load(session: Session, notes: TimedNote[], durationSec: number, loop: boolean): Promise<void> {
    await this.warmUp();
    const bytes = encodeMidi(session, notes);
    this.pcm = await renderMidiPcm(bytes, this.options.sf2Path, this.sampleRate);
    this.audioBuffer = undefined;
    this.durationSec = durationSec;
    this.loop = loop;
  }

  play(fromSec = 0): void {
    if (!this.pcm) return;
    this.ensureContext();
    this.stopSource();
    const ctx = this.ctx!;
    if (ctx.state === "suspended") void ctx.resume();
    if (!this.audioBuffer) {
      const buffer = ctx.createBuffer(2, this.pcm.left.length, this.sampleRate);
      buffer.copyToChannel(this.pcm.left as Float32Array, 0);
      buffer.copyToChannel(this.pcm.right as Float32Array, 1);
      this.audioBuffer = buffer;
    }
    const source = ctx.createBufferSource();
    source.buffer = this.audioBuffer;
    source.loop = this.loop;
    source.connect(this.ensureMaster());
    const offset = Math.max(0, Math.min(fromSec, this.durationSec || fromSec));
    source.start(0, offset);
    this.source = source;
    this.playing = true;
    this.offsetSec = offset;
    this.startedAt = ctx.currentTime;
    this.tickTimer ??= setInterval(() => {
      if (!this.playing) return;
      const position = this.positionSec;
      this.onTick?.(position);
      if (!this.loop && position >= this.durationSec - 0.01) this.stop();
    }, 100);
  }

  /** 拖拽进度：播放中重定位；暂停时只更新偏移。 */
  seek(sec: number): void {
    const offset = Math.max(0, Math.min(sec, this.durationSec || sec));
    if (this.playing) {
      this.play(offset);
      return;
    }
    this.offsetSec = offset;
    this.onTick?.(offset);
  }

  pause(): void {
    if (!this.playing) return;
    this.offsetSec = this.positionSec;
    this.playing = false;
    this.stopSource();
  }

  stop(): void {
    this.playing = false;
    this.offsetSec = 0;
    this.stopSource();
    this.onTick?.(0);
  }

  async noteOn(note: number, velocity: number, channel: number, program: number): Promise<void> {
    await this.ensureLiveSynth();
    const ctx = this.ensureContext();
    if (ctx.state === "suspended") void ctx.resume();
    const holdSec = padHoldSec(channel, program);
    const key = `${channel}:${note}`;
    const prevTimer = this.autoOffTimers.get(key);
    if (prevTimer) clearTimeout(prevTimer);

    this.midiQueue.push(() => {
      const synth = this.liveSynth!;
      if (this.channelProgram.get(channel) !== program) {
        synth.programChange(channel, program);
        this.channelProgram.set(channel, program);
      }
      // 同键重触发：先关再开，避免叠声部拖尾。
      synth.noteOff(channel, note);
      synth.noteOn(channel, note, velocity);
    });
    this.lastLiveActivityMs = Date.now();
    this.startLivePump();

    this.autoOffTimers.set(
      key,
      setTimeout(() => {
        this.autoOffTimers.delete(key);
        this.noteOff(note, channel);
      }, Math.round(holdSec * 1000)),
    );
  }

  noteOff(note: number, channel: number): void {
    if (!this.liveSynth) return;
    this.midiQueue.push(() => {
      this.liveSynth?.noteOff(channel, note);
    });
    this.lastLiveActivityMs = Date.now();
    this.startLivePump();
  }

  dispose(): void {
    this.stop();
    this.stopLivePump();
    for (const timer of this.autoOffTimers.values()) clearTimeout(timer);
    this.autoOffTimers.clear();
    this.midiQueue = [];
    this.liveSynth = undefined;
    this.liveInit = undefined;
    this.channelProgram.clear();
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = undefined;
    void this.ctx?.close();
    this.ctx = undefined;
    this.master = undefined;
  }

  private async ensureLiveSynth(): Promise<void> {
    this.ensureContext();
    this.liveInit ??= this.initLiveSynth();
    await this.liveInit;
  }

  private async initLiveSynth(): Promise<void> {
    const ctx = this.ensureContext();
    const sampleRate = ctx.sampleRate || this.sampleRate;
    const sfBytes = readFileSync(this.options.sf2Path);
    const soundBank = SoundBankLoader.fromArrayBuffer(
      sfBytes.buffer.slice(sfBytes.byteOffset, sfBytes.byteOffset + sfBytes.byteLength) as ArrayBuffer,
    );
    const synth = new SpessaSynthProcessor(sampleRate, { eventsEnabled: false });
    synth.soundBankManager.addSoundBank(soundBank, "main");
    await synth.processorInitialized;
    synth.setSystemParameter("autoAllocateVoices", true);
    this.liveSynth = synth;
  }

  private startLivePump(): void {
    if (this.livePumpTimer) return;
    const ctx = this.ensureContext();
    this.nextLiveTime = Math.max(ctx.currentTime, this.nextLiveTime);
    // 不立刻 pump：让同一事件轮次里连发的 noteOn 先入队，再同一次 flush（和弦音头对齐）。
    this.livePumpTimer = setInterval(() => this.pumpLive(), LIVE_PUMP_INTERVAL_MS);
  }

  private stopLivePump(): void {
    if (this.livePumpTimer) clearInterval(this.livePumpTimer);
    this.livePumpTimer = undefined;
  }

  private flushMidi(): void {
    if (!this.midiQueue.length) return;
    const batch = this.midiQueue.splice(0, this.midiQueue.length);
    for (const op of batch) op();
  }

  private pumpLive(): void {
    if (!this.liveSynth || !this.ctx) {
      this.stopLivePump();
      return;
    }
    this.flushMidi();
    const ctx = this.ctx;
    const sampleRate = this.liveSynth.sampleRate;
    const quantumFrames = Math.max(SPESSA_BUFSIZE, Math.round(sampleRate * LIVE_QUANTUM_SEC));
    // 对齐到 Spessa 块大小，避免 process 超限。
    const frames = Math.ceil(quantumFrames / SPESSA_BUFSIZE) * SPESSA_BUFSIZE;
    const quantumSec = frames / sampleRate;
    const master = this.ensureMaster();

    if (this.nextLiveTime < ctx.currentTime) {
      this.nextLiveTime = ctx.currentTime;
    }

    while (this.nextLiveTime < ctx.currentTime + LIVE_LOOKAHEAD_SEC) {
      const left = new Float32Array(frames);
      const right = new Float32Array(frames);
      let offset = 0;
      while (offset < frames) {
        const size = Math.min(SPESSA_BUFSIZE, frames - offset);
        this.liveSynth.process(left, right, offset, size);
        offset += size;
      }
      const buffer = ctx.createBuffer(2, frames, sampleRate);
      buffer.copyToChannel(left, 0);
      buffer.copyToChannel(right, 1);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(master);
      source.start(this.nextLiveTime);
      this.nextLiveTime += quantumSec;
    }

    if (Date.now() - this.lastLiveActivityMs > LIVE_IDLE_MS) {
      this.stopLivePump();
    }
  }

  private ensureContext(): AudioContextLike {
    if (!this.ctx) this.ctx = this.createContext();
    return this.ctx;
  }

  private ensureMaster(): any {
    if (this.master) return this.master;
    const ctx = this.ensureContext();
    const gain = ctx.createGain();
    gain.gain.value = this.masterGain;
    const shaper = ctx.createWaveShaper();
    shaper.curve = saturationCurve();
    gain.connect(shaper);
    shaper.connect(ctx.destination);
    this.master = gain;
    return gain;
  }

  private stopSource(): void {
    try {
      this.source?.stop();
    } catch {
      // already stopped
    }
    this.source = undefined;
  }
}
