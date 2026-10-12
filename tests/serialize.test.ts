import { parseSession } from "../src/parser";
import { emptyTemplate, formatSessionText, sortTrackRows } from "../src/serialize";

test("emptyTemplate has core + strings role tracks", () => {
  const session = parseSession(emptyTemplate({ bpm: 120, bars: 2 }));
  expect(session.tracks.map((t) => t.role).sort()).toEqual([
    "bass", "drums", "guitar", "keys", "strings",
  ]);
});

test("formatSessionText preserves sustain cells", () => {
  const src = emptyTemplate();
  const again = formatSessionText(parseSession(src));
  expect(parseSession(again).tracks.length).toBe(5);
});

test("formatSessionText writes vs-daw 2 and program 1–128", () => {
  const text = formatSessionText(parseSession(`# vs-daw 1
track piano
role: keys
program: 0
C4 |x...|
`));
  expect(text).toMatch(/^# vs-daw 2/m);
  expect(text).toMatch(/^program: 1$/m);
  expect(parseSession(text).tracks[0].program).toBe(0);
});

test("pitch rows serialize high notes above low notes", () => {
  const session = parseSession(`# vs-daw 1
bpm: 120
meter: 4/4
steps: 4

track piano
role: keys
C3     |x...|
C5     |.x..|
C4     |..x.|
`);
  const text = formatSessionText(session);
  const piano = text.split("\n").filter((line) => /^C\d/.test(line));
  expect(piano.map((line) => line.trim().split(/\s+/)[0])).toEqual(["C5", "C4", "C3"]);
});

test("sortTrackRows orders pitches descending", () => {
  const track = parseSession(`# vs-daw 1
bpm: 120
meter: 4/4
steps: 4
track piano
role: keys
E2 |x...|
C4 |.x..|
`).tracks[0];
  sortTrackRows(track);
  expect(track.rows.map((row) => row.id)).toEqual(["C4", "E2"]);
});
