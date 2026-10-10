export type DrumId =
  | "kick" | "snare" | "ch" | "oh" | "clap"
  | "tom1" | "tom2" | "tom3" | "crash" | "ride";

/** GM 大类轨角色；sample 为包内/旁路采样音频触发。 */
export type TrackRole =
  | "drums"
  | "keys"
  | "guitar"
  | "bass"
  | "strings"
  | "brass"
  | "woodwind"
  | "pad"
  | "sample";

/** rest/hold；起音：o/x/X 或力度档 1(最弱)–9(最强)。 */
export type CellKind =
  | "rest"
  | "hit"
  | "accent"
  | "ghost"
  | "hold"
  | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

export interface ParseWarning {
  message: string;
  line?: number;
}

export interface GridRow {
  id: string;
  cells: CellKind[];
  lineIndex: number;
}

export interface DawTrack {
  name: string;
  role: TrackRole;
  plugin: string;
  program?: number;
  channel?: number;
  rows: GridRow[];
}

export interface Session {
  bpm: number;
  meter: string;
  stepsPerBar: number;
  swing: number;
  tracks: DawTrack[];
  warnings: ParseWarning[];
  unsupportedVersion: boolean;
}

export interface TimedNote {
  trackName: string;
  role: TrackRole;
  note: number;
  velocity: number;
  timeSec: number;
  durationSec: number;
  channel: number;
  program: number;
  /** role=sample 时：相对工程根或包根的资源路径（如 assets/kick.wav）。 */
  samplePath?: string;
}

export type TransportStatus = "stopped" | "playing" | "paused";

/** @deprecated Prefer Session; kept temporarily for migration of leftover imports. */
export type HitKind = CellKind;
export type Track = GridRow & { canonicalId?: DrumId | null };
export type Score = Session & { kit?: string };
export type ScheduledNote = TimedNote;
