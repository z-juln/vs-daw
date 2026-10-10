import { Session } from "../types";
import { cellToChar } from "../velocity";

export interface GridRowView {
  id: string;
  cells: string[];
}

export interface GridSessionView {
  trackName: string;
  trackNames: string[];
  trackRole?: string;
  /** 当前采样轨的触发偏移（秒）。 */
  sampleOffsetSec?: number;
  bpm: number;
  meter: string;
  stepsPerBar: number;
  swing: number;
  rows: GridRowView[];
  warnings: { message: string; line?: number }[];
  unsupportedVersion: boolean;
}

export function sessionToView(session: Session, trackName?: string): GridSessionView {
  const trackNames = session.tracks.map((track) => track.name);
  const track = (trackName
    ? session.tracks.find((item) => item.name === trackName)
    : undefined) ?? session.tracks[0];
  const resolvedName = track?.name ?? trackName ?? "";
  return {
    trackName: resolvedName,
    trackNames,
    trackRole: track?.role,
    sampleOffsetSec: track?.role === "sample" ? (track.offsetSec ?? 0) : undefined,
    bpm: session.bpm,
    meter: session.meter,
    stepsPerBar: session.stepsPerBar,
    swing: session.swing,
    rows: (track?.rows ?? []).map((row) => ({
      id: row.id,
      cells: row.cells.map((cell) => cellToChar(cell)),
    })),
    warnings: session.warnings.map((warning) => ({
      message: warning.message,
      line: warning.line,
    })),
    unsupportedVersion: session.unsupportedVersion,
  };
}

/** 设置采样轨轨级 offset（秒）。 */
export function applySampleTrackOffset(
  session: Session,
  trackName: string,
  offsetSec: number,
): Session {
  const value = Number.isFinite(offsetSec)
    ? Math.min(60, Math.max(-60, offsetSec))
    : 0;
  return {
    ...session,
    tracks: session.tracks.map((track) => {
      if (track.name !== trackName || track.role !== "sample") return track;
      return {
        ...track,
        offsetSec: value === 0 ? undefined : value,
      };
    }),
  };
}

export function applyHeaderFields(
  session: Session,
  fields: Partial<{ bpm: number; meter: string; stepsPerBar: number; swing: number }>,
): Session {
  return {
    ...session,
    bpm: fields.bpm ?? session.bpm,
    meter: fields.meter ?? session.meter,
    stepsPerBar: fields.stepsPerBar ?? session.stepsPerBar,
    swing: fields.swing ?? session.swing,
  };
}
