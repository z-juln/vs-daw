export const SPESSA_BUFSIZE = 128;

export class BasicMIDI {
  static fromArrayBuffer() { return { duration: 0, tracks: [] }; }
}
export class SoundBankLoader {
  static fromArrayBuffer() { return {}; }
}
export class SpessaSynthProcessor {
  sampleRate: number;

  soundBankManager = { addSoundBank() {} };

  processorInitialized = Promise.resolve();

  noteOnCalls: Array<{ channel: number; note: number; velocity: number }> = [];

  noteOffCalls: Array<{ channel: number; note: number }> = [];

  programChanges: Array<{ channel: number; program: number }> = [];

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  setSystemParameter() {}

  programChange(channel: number, programNumber: number) {
    this.programChanges.push({ channel, program: programNumber });
  }

  noteOn(channel: number, midiNote: number, velocity: number) {
    this.noteOnCalls.push({ channel, note: midiNote, velocity });
  }

  noteOff(channel: number, midiNote: number) {
    this.noteOffCalls.push({ channel, note: midiNote });
  }

  process(left: Float32Array, right: Float32Array, startIndex = 0, sampleCount?: number) {
    const count = sampleCount ?? left.length - startIndex;
    // 非静音占位，方便确认泵在写缓冲。
    for (let i = 0; i < count; i += 1) {
      left[startIndex + i] = 0.01;
      right[startIndex + i] = 0.01;
    }
  }
}
export class SpessaSynthSequencer {
  loadNewSongList() {}
  play() {}
  processTick() {}
}
export function audioToWav() { return new ArrayBuffer(0); }
