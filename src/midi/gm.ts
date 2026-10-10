import { TrackRole } from "../types";

export const TRACK_ROLES: TrackRole[] = [
  "drums",
  "keys",
  "guitar",
  "bass",
  "strings",
  "brass",
  "woodwind",
  "pad",
  "sample",
];

export const ROLE_LABEL_ZH: Record<TrackRole, string> = {
  drums: "鼓",
  keys: "钢琴",
  guitar: "吉他",
  bass: "贝斯",
  strings: "弦乐",
  brass: "铜管",
  woodwind: "木管",
  pad: "合成 Pad",
  sample: "采样",
};

export const DEFAULT_PLUGIN: Record<TrackRole, string> = {
  drums: "drum.gm",
  keys: "keys.gm",
  guitar: "gtr.gm",
  bass: "bass.gm",
  strings: "strings.gm",
  brass: "brass.gm",
  woodwind: "woodwind.gm",
  pad: "pad.gm",
  sample: "sample.file",
};

export const DEFAULT_PROGRAM: Record<TrackRole, number> = {
  drums: 0,
  keys: 0, // Acoustic Grand Piano
  guitar: 24, // Nylon Guitar
  bass: 32, // Acoustic Bass
  strings: 48, // String Ensemble 1
  brass: 61, // Brass Section
  woodwind: 73, // Flute
  pad: 89, // Warm Pad
  sample: 0,
};

/** 0-based MIDI channels; drums use channel 10 → index 9. */
export const DEFAULT_CHANNEL: Record<TrackRole, number> = {
  drums: 9,
  keys: 0,
  guitar: 1,
  bass: 2,
  strings: 3,
  brass: 4,
  woodwind: 5,
  pad: 6,
  sample: 7,
};

/** Pad 默认八度（低排起始）。 */
export const DEFAULT_OCTAVE: Record<TrackRole, number> = {
  drums: 4,
  keys: 3,
  guitar: 2,
  bass: 1,
  strings: 3,
  brass: 3,
  woodwind: 4,
  pad: 3,
  sample: 4,
};

export const DRUM_TO_GM: Record<string, number> = {
  kick: 36,
  snare: 38,
  ch: 42,
  oh: 46,
  clap: 39,
  tom1: 50,
  tom2: 47,
  tom3: 45,
  crash: 49,
  ride: 51,
};

export const GM_TO_DRUM: Record<number, string> = Object.fromEntries(
  Object.entries(DRUM_TO_GM).map(([id, note]) => [note, id]),
);

export function roleFromProgram(program: number, channel: number): TrackRole {
  if (channel === 9) return "drums";
  if (program >= 24 && program <= 31) return "guitar";
  if (program >= 32 && program <= 39) return "bass";
  if (program >= 40 && program <= 55) return "strings";
  if (program >= 56 && program <= 63) return "brass";
  if (program >= 64 && program <= 79) return "woodwind";
  if (program >= 88 && program <= 95) return "pad";
  return "keys";
}

export function isPitchRole(role: TrackRole): boolean {
  return role !== "drums" && role !== "sample";
}

export function isSampleRole(role: TrackRole): boolean {
  return role === "sample";
}
