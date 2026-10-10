import { parseSession } from "../src/parser";
import { scheduleSession } from "../src/schedule";
import { formatSessionText } from "../src/serialize";
import { stepTimeSec } from "../src/schedule";

test("track offset shifts sample trigger time", () => {
  const session = parseSession(`# vs-daw 1
bpm: 120
steps: 4
track samples
role: sample
offset: -0.25
assets/a.wav |x...|
`);
  expect(session.tracks[0].offsetSec).toBe(-0.25);
  const notes = scheduleSession(session);
  expect(notes[0].timeSec).toBeCloseTo(stepTimeSec(session, 0) - 0.25, 5);
});

test("row offset overrides track offset", () => {
  const session = parseSession(`# vs-daw 1
bpm: 120
steps: 4
track samples
role: sample
offset: -0.5
assets/a.wav offset:0.1 |x...|
`);
  expect(session.tracks[0].rows[0].sampleOffsetSec).toBe(0.1);
  const notes = scheduleSession(session);
  expect(notes[0].timeSec).toBeCloseTo(stepTimeSec(session, 0) + 0.1, 5);
});

test("serialize round-trips sample offsets", () => {
  const src = `# vs-daw 1
bpm: 100
steps: 8
track samples
role: sample
plugin: sample.file
offset: -0.08
assets/vocals.wav offset:-0.02 |3.......|
`;
  const again = formatSessionText(parseSession(src));
  const session = parseSession(again);
  expect(session.tracks[0].offsetSec).toBeCloseTo(-0.08, 5);
  expect(session.tracks[0].rows[0].sampleOffsetSec).toBeCloseTo(-0.02, 5);
});
