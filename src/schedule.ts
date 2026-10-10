import { normalizeSamplePath } from "./dawPackage";
import { canonicalDrumId } from "./drums";
import { DEFAULT_CHANNEL, DEFAULT_PROGRAM, DRUM_TO_GM } from "./midi/gm";
import { pitchToMidi } from "./pitch";
import { Session, TimedNote, TrackRole } from "./types";
import { cellVelocity } from "./velocity";

export interface TimingContext {
  bpm: number;
  meter: string;
  stepsPerBar: number;
  swing: number;
}

function meterParts(meter: string): [number, number] {
  const match = meter.match(/^(\d+)\/(\d+)$/);
  const numerator = Number(match?.[1]);
  const denominator = Number(match?.[2]);
  return numerator > 0 && denominator > 0 ? [numerator, denominator] : [4, 4];
}

export function stepDurationSec(context: TimingContext): number {
  const [numerator, denominator] = meterParts(context.meter);
  const barSec = numerator * (60 / context.bpm) * (4 / denominator);
  return barSec / context.stepsPerBar;
}

export function stepTimeSec(context: TimingContext, step: number): number {
  const duration = stepDurationSec(context);
  const swingDelay = step % 2 === 1
    ? (context.swing / 100) * (duration / 2)
    : 0;
  return step * duration + swingDelay;
}

function resolveNote(role: TrackRole, rowId: string): number | null {
  if (role === "sample") return null;
  if (role === "drums") {
    const drumId = canonicalDrumId(rowId);
    if (!drumId) return null;
    return DRUM_TO_GM[drumId] ?? null;
  }
  return pitchToMidi(rowId);
}

/** Schedule all tracks into timed MIDI / sample events (drums ignore hold length). */
export function scheduleSession(session: Session): TimedNote[] {
  const notes: TimedNote[] = [];
  const stepSec = stepDurationSec(session);
  for (const track of session.tracks) {
    const program = track.program ?? DEFAULT_PROGRAM[track.role];
    const channel = track.channel ?? DEFAULT_CHANNEL[track.role];
    for (const row of track.rows) {
      if (track.role === "sample") {
        const samplePath = normalizeSamplePath(row.id);
        if (!samplePath) continue;
        const offsetSec = row.sampleOffsetSec ?? track.offsetSec ?? 0;
        for (let step = 0; step < row.cells.length; step += 1) {
          const cell = row.cells[step];
          const velocity = cellVelocity(cell);
          if (velocity <= 0) continue;
          let end = step + 1;
          while (end < row.cells.length && row.cells[end] === "hold") end += 1;
          notes.push({
            trackName: track.name,
            role: "sample",
            note: 0,
            velocity,
            // 允许为负：混音时从采样中段起播，相当于相对格子提前
            timeSec: stepTimeSec(session, step) + offsetSec,
            durationSec: Math.max(stepSec * 0.9, (end - step) * stepSec),
            channel,
            program,
            samplePath,
          });
        }
        continue;
      }
      const note = resolveNote(track.role, row.id);
      if (note === null) continue;
      for (let step = 0; step < row.cells.length; step += 1) {
        const cell = row.cells[step];
        const velocity = cellVelocity(cell);
        if (velocity <= 0) continue;
        let end = step + 1;
        while (end < row.cells.length && row.cells[end] === "hold") end += 1;
        const durationSec = track.role === "drums"
          ? Math.min(0.15, stepSec)
          : Math.max(stepSec * 0.9, (end - step) * stepSec);
        notes.push({
          trackName: track.name,
          role: track.role,
          note,
          velocity,
          timeSec: stepTimeSec(session, step),
          durationSec,
          channel,
          program,
        });
      }
    }
  }
  return notes.sort((left, right) => left.timeSec - right.timeSec
    || left.note - right.note
    || (left.samplePath ?? "").localeCompare(right.samplePath ?? ""));
}

export function sessionHasSampleTracks(session: Session): boolean {
  return session.tracks.some((track) => track.role === "sample");
}

/** MIDI 可编码事件（去掉采样触发）。 */
export function midiNotesOnly(notes: TimedNote[]): TimedNote[] {
  return notes.filter((note) => !note.samplePath && note.role !== "sample");
}

export function scoreDurationSec(session: Session): number {
  const length = Math.max(
    0,
    ...session.tracks.flatMap((track) => track.rows.map((row) => row.cells.length)),
  );
  return length * stepDurationSec(session);
}

/** @deprecated */
export const scheduleNotes = scheduleSession;
