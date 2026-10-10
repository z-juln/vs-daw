import { midiNotesOnly, scheduleSession } from "../schedule";
import { Session, TimedNote } from "../types";

const TPQ = 480;

function secToTicks(sec: number, bpm: number): number {
  return Math.max(0, Math.round(sec * (bpm / 60) * TPQ));
}

function writeVarLen(value: number): number[] {
  let buffer = value & 0x7f;
  const bytes: number[] = [];
  while ((value >>= 7)) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  for (;;) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return bytes;
}

/** Same-tick order: meta → program/CC → note off → note on. */
function eventPriority(data: number[]): number {
  const status = data[0];
  if (status === 0xff) return 0;
  const hi = status & 0xf0;
  if (hi === 0xc0 || hi === 0xb0) return 1;
  if (hi === 0x80) return 2;
  if (hi === 0x90) return 3;
  return 4;
}

function trackBytes(events: { tick: number; data: number[] }[]): Buffer {
  events.sort((a, b) => a.tick - b.tick || eventPriority(a.data) - eventPriority(b.data));
  const body: number[] = [];
  let last = 0;
  for (const event of events) {
    body.push(...writeVarLen(event.tick - last));
    body.push(...event.data);
    last = event.tick;
  }
  body.push(...writeVarLen(0), 0xff, 0x2f, 0x00);
  const header = Buffer.alloc(8);
  header.write("MTrk", 0);
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, Buffer.from(body)]);
}

/** Encode session notes to standard Type-1 SMF bytes（自动跳过采样轨/采样事件）。 */
export function encodeMidi(
  session: Session,
  notes: TimedNote[] = scheduleSession(session),
): Uint8Array {
  const midiNotes = midiNotesOnly(notes);
  const tempo = Math.round(60_000_000 / session.bpm);
  const conductor = trackBytes([
    { tick: 0, data: [0xff, 0x51, 0x03, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff] },
  ]);

  const byTrack = new Map<string, TimedNote[]>();
  for (const note of midiNotes) {
    const list = byTrack.get(note.trackName) ?? [];
    list.push(note);
    byTrack.set(note.trackName, list);
  }

  // Preserve session track order even if empty（跳过采样轨）
  const order = session.tracks
    .filter((track) => track.role !== "sample")
    .map((track) => track.name);
  for (const name of byTrack.keys()) {
    if (!order.includes(name)) order.push(name);
  }

  const tracks = order.map((name) => {
    const events: { tick: number; data: number[] }[] = [
      {
        tick: 0,
        data: [0xff, 0x03, name.length, ...Buffer.from(name, "ascii")],
      },
    ];
    const list = byTrack.get(name) ?? [];
    if (list.length > 0) {
      const { channel, program } = list[0];
      events.push({ tick: 0, data: [0xc0 | (channel & 0x0f), program & 0x7f] });
      for (const note of list) {
        const on = secToTicks(note.timeSec, session.bpm);
        const off = Math.max(on + 1, secToTicks(note.timeSec + note.durationSec, session.bpm));
        events.push({
          tick: on,
          data: [0x90 | (note.channel & 0x0f), note.note & 0x7f, note.velocity & 0x7f],
        });
        events.push({
          tick: off,
          data: [0x80 | (note.channel & 0x0f), note.note & 0x7f, 0x40],
        });
      }
    }
    return trackBytes(events);
  });

  const header = Buffer.alloc(14);
  header.write("MThd", 0);
  header.writeUInt32BE(6, 4);
  header.writeUInt16BE(1, 8);
  header.writeUInt16BE(1 + tracks.length, 10);
  header.writeUInt16BE(TPQ, 12);
  return new Uint8Array(Buffer.concat([header, conductor, ...tracks]));
}
