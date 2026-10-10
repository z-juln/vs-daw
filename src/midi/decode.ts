import { midiToPitch } from "../pitch";
import { sortTrackRows } from "../serialize";
import { CellKind, DawTrack, Session, TrackRole } from "../types";
import { velocityToCell } from "../velocity";
import { DEFAULT_PLUGIN, GM_TO_DRUM, roleFromProgram } from "./gm";

interface RawNote {
  channel: number;
  program: number;
  note: number;
  velocity: number;
  startTick: number;
  endTick: number;
  trackName: string;
}

const PLUGIN = DEFAULT_PLUGIN;

function readVarLen(view: DataView, offset: { value: number }): number {
  let result = 0;
  for (;;) {
    const byte = view.getUint8(offset.value);
    offset.value += 1;
    result = (result << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return result;
  }
}

function parseTrack(
  data: Uint8Array,
  trackNameFallback: string,
): { name: string; notes: RawNote[]; tempo?: number } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const offset = { value: 0 };
  let tick = 0;
  let status = 0;
  let name = trackNameFallback;
  let program = 0;
  let tempo: number | undefined;
  const open = new Map<string, RawNote>();
  const notes: RawNote[] = [];

  while (offset.value < data.length) {
    tick += readVarLen(view, offset);
    if (offset.value >= data.length) break;
    let byte = view.getUint8(offset.value);
    if (byte >= 0x80) {
      status = byte;
      offset.value += 1;
    }
    if (status === 0xff) {
      const type = view.getUint8(offset.value);
      offset.value += 1;
      const length = readVarLen(view, offset);
      const payload = data.subarray(offset.value, offset.value + length);
      offset.value += length;
      if (type === 0x2f) break;
      if (type === 0x03) name = Buffer.from(payload).toString("ascii") || name;
      if (type === 0x51 && length === 3) {
        const us = (payload[0] << 16) | (payload[1] << 8) | payload[2];
        tempo = Math.round(60_000_000 / us);
      }
      continue;
    }
    if (status >= 0xc0 && status <= 0xcf) {
      program = view.getUint8(offset.value);
      offset.value += 1;
      continue;
    }
    if (status >= 0x90 && status <= 0x9f) {
      const note = view.getUint8(offset.value);
      const velocity = view.getUint8(offset.value + 1);
      offset.value += 2;
      const channel = status & 0x0f;
      const key = `${channel}:${note}`;
      if (velocity > 0) {
        open.set(key, {
          channel, program, note, velocity, startTick: tick, endTick: tick + 120, trackName: name,
        });
      } else {
        const started = open.get(key);
        if (started) {
          started.endTick = tick;
          notes.push(started);
          open.delete(key);
        }
      }
      continue;
    }
    if (status >= 0x80 && status <= 0x8f) {
      const note = view.getUint8(offset.value);
      offset.value += 2;
      const channel = status & 0x0f;
      const key = `${channel}:${note}`;
      const started = open.get(key);
      if (started) {
        started.endTick = tick;
        notes.push(started);
        open.delete(key);
      }
      continue;
    }
    // Skip other channel messages conservatively
    if (status >= 0xa0 && status <= 0xef) offset.value += status >= 0xc0 && status <= 0xdf ? 1 : 2;
    else break;
  }
  for (const leftover of open.values()) notes.push(leftover);
  return { name, notes, tempo };
}

export function decodeMidiToSession(bytes: Uint8Array): Session {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 14 || Buffer.from(bytes.subarray(0, 4)).toString() !== "MThd") {
    throw new Error("不是有效的 MIDI 文件");
  }
  const format = view.getUint16(8);
  const trackCount = view.getUint16(10);
  const tpq = view.getUint16(12);
  void format;
  let offset = 14;
  let bpm = 120;
  const allNotes: RawNote[] = [];

  for (let index = 0; index < trackCount && offset + 8 <= bytes.length; index += 1) {
    const id = Buffer.from(bytes.subarray(offset, offset + 4)).toString();
    const length = view.getUint32(offset + 4);
    offset += 8;
    if (id !== "MTrk") break;
    const chunk = bytes.subarray(offset, offset + length);
    offset += length;
    const parsed = parseTrack(chunk, `track${index}`);
    if (parsed.tempo) bpm = parsed.tempo;
    allNotes.push(...parsed.notes.map((note) => ({ ...note, trackName: parsed.name })));
  }

  const stepsPerBar = 16;
  const stepTicks = tpq / 4;
  const byTrack = new Map<string, RawNote[]>();
  for (const note of allNotes) {
    const list = byTrack.get(note.trackName) ?? [];
    list.push(note);
    byTrack.set(note.trackName, list);
  }

  const tracks: DawTrack[] = [];
  for (const [name, notes] of byTrack) {
    if (notes.length === 0) continue;
    const sample = notes[0];
    const role = roleFromProgram(sample.program, sample.channel);
    const maxTick = Math.max(...notes.map((n) => n.endTick), tpq * 4);
    const totalSteps = Math.max(stepsPerBar, Math.ceil(maxTick / stepTicks));
    const rows = new Map<string, CellKind[]>();
    for (const note of notes) {
      const rowId = role === "drums"
        ? (GM_TO_DRUM[note.note] ?? `n${note.note}`)
        : midiToPitch(note.note);
      if (!rows.has(rowId)) rows.set(rowId, Array(totalSteps).fill("rest"));
      const cells = rows.get(rowId)!;
      const start = Math.min(totalSteps - 1, Math.floor(note.startTick / stepTicks));
      const end = Math.min(totalSteps, Math.max(start + 1, Math.ceil(note.endTick / stepTicks)));
      cells[start] = velocityToCell(note.velocity);
      for (let step = start + 1; step < end; step += 1) {
        if (role !== "drums" && cells[step] === "rest") cells[step] = "hold";
      }
    }
    const track = {
      name,
      role,
      plugin: PLUGIN[role],
      program: sample.program,
      channel: sample.channel,
      rows: [...rows.entries()].map(([id, cells], lineIndex) => ({ id, cells, lineIndex })),
    };
    sortTrackRows(track);
    tracks.push(track);
  }

  return {
    bpm,
    meter: "4/4",
    stepsPerBar,
    swing: 0,
    tracks,
    warnings: [],
    unsupportedVersion: false,
  };
}
