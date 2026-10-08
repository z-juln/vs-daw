import { pitchToMidi } from "./pitch";
import { CellKind, DawTrack } from "./types";

export interface MelodyNote {
  step: number;
  pitch: string;
  midi: number;
}

export type LearnFeedback = "idle" | "correct" | "wrong" | "done";

export interface LearnUiState {
  active: boolean;
  pitch: string;
  step: number;
  index: number;
  total: number;
  feedback: LearnFeedback;
}

function isOnsetCell(cell: CellKind): boolean {
  return cell !== "rest" && cell !== "hold";
}

/** 每个起音 step 取最高音，组成旋律队列；从 fromStep 起（含）。 */
export function extractMelody(track: DawTrack, fromStep = 0): MelodyNote[] {
  const start = Math.max(0, Math.floor(fromStep));
  const pitched = track.rows
    .map((row) => ({ row, midi: pitchToMidi(row.id) }))
    .filter((item): item is { row: typeof item.row; midi: number } => item.midi !== null);
  const maxSteps = pitched.reduce((max, item) => Math.max(max, item.row.cells.length), 0);
  const notes: MelodyNote[] = [];
  for (let step = start; step < maxSteps; step += 1) {
    let best: MelodyNote | undefined;
    for (const { row, midi } of pitched) {
      const cell = row.cells[step] ?? "rest";
      if (!isOnsetCell(cell)) continue;
      if (!best || midi > best.midi) {
        best = { step, pitch: row.id, midi };
      }
    }
    if (best) notes.push(best);
  }
  return notes;
}

export function learnUiState(
  notes: MelodyNote[],
  index: number,
  feedback: LearnFeedback,
): LearnUiState {
  const total = notes.length;
  if (total === 0 || index >= total) {
    return {
      active: true,
      pitch: "",
      step: -1,
      index: total,
      total,
      feedback: total === 0 ? "done" : "done",
    };
  }
  const current = notes[index]!;
  return {
    active: true,
    pitch: current.pitch,
    step: current.step,
    index,
    total,
    feedback,
  };
}
