import { parseSession } from "../src/parser";

test("parses global header and multi tracks with sustain", () => {
  const session = parseSession(`# vs-daw 1
bpm: 100
steps: 8
track drums
role: drums
kick |x...x...|
track piano
role: keys
program: 0
C4   |x===....|
`);
  expect(session.bpm).toBe(100);
  expect(session.tracks).toHaveLength(2);
  expect(session.tracks[1].rows[0].cells.slice(0, 4)).toEqual([
    "hit", "hold", "hold", "hold",
  ]);
});

test("unknown role falls back to keys with warning", () => {
  const session = parseSession(`track x
role: harp
C4 |x...|
`);
  expect(session.tracks[0].role).toBe("keys");
  expect(session.warnings.some((w) => w.message.includes("role"))).toBe(true);
});

test("parses strings / brass / woodwind / lead / pad / ethnic / fx roles", () => {
  const session = parseSession(`# vs-daw 2
track strings
role: strings
program: 49
C4 |4=======|
track brass
role: brass
G4 |6=======|
track woodwind
role: woodwind
C5 |4===....|
track lead
role: lead
C5 |5=======|
track pad
role: pad
E4 |2=======|
track ethnic
role: ethnic
program: 109
C5 |6=======|
track fx
role: fx
C4 |3=======|
`);
  expect(session.tracks.map((t) => t.role)).toEqual([
    "strings",
    "brass",
    "woodwind",
    "lead",
    "pad",
    "ethnic",
    "fx",
  ]);
  expect(session.tracks[0].program).toBe(48);
  expect(session.tracks[5].program).toBe(108);
});

test("v2 program 1–128 maps to internal 0–127; v1 keeps 0–127", () => {
  const v2 = parseSession(`# vs-daw 2
track piano
role: keys
program: 1
C4 |x...|
`);
  expect(v2.tracks[0].program).toBe(0);

  const v1 = parseSession(`# vs-daw 1
track piano
role: keys
program: 0
C4 |x...|
`);
  expect(v1.tracks[0].program).toBe(0);
  expect(v1.unsupportedVersion).toBe(false);
});

test("global steps with velocity chars", () => {
  const session = parseSession(`steps: 8
track drums
role: drums
kick |xXo*.q..|
`);
  expect(session.tracks[0].rows[0].cells.slice(0, 6)).toEqual([
    "hit", "accent", "ghost", "hit", "rest", "rest",
  ]);
  expect(session.warnings.some((w) => w.message.includes("q"))).toBe(true);
});
