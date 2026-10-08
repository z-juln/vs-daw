import { extractMelody, learnUiState } from "../src/melodyLearn";
import { DawTrack } from "../src/types";

function track(rows: { id: string; cells: string }[]): DawTrack {
  return {
    name: "piano",
    role: "keys",
    plugin: "sf2",
    rows: rows.map((row, lineIndex) => ({
      id: row.id,
      cells: row.cells.split("").map((ch) => {
        if (ch === ".") return "rest" as const;
        if (ch === "=") return "hold" as const;
        if (/^[1-9]$/.test(ch)) return ch as "1";
        return "6" as const;
      }),
      lineIndex,
    })),
  };
}

describe("extractMelody", () => {
  it("每个起音 step 只取最高音，跳过休止与延音", () => {
    const notes = extractMelody(
      track([
        { id: "E4", cells: "4.=.2" },
        { id: "C#5", cells: ".4=.." },
        { id: "G3", cells: "6...." },
      ]),
      0,
    );
    expect(notes.map((n) => `${n.step}:${n.pitch}`)).toEqual([
      "0:E4",
      "1:C#5",
      "4:E4",
    ]);
  });

  it("从 fromStep 起截取", () => {
    const notes = extractMelody(
      track([
        { id: "C#5", cells: "4.4.4" },
        { id: "D#5", cells: ".4.4." },
      ]),
      2,
    );
    expect(notes.map((n) => `${n.step}:${n.pitch}`)).toEqual([
      "2:C#5",
      "3:D#5",
      "4:C#5",
    ]);
  });

  it("同列多音取最高", () => {
    const notes = extractMelody(
      track([
        { id: "E4", cells: "4" },
        { id: "C#5", cells: "4" },
      ]),
      0,
    );
    expect(notes).toEqual([{ step: 0, pitch: "C#5", midi: 73 }]);
  });
});

describe("learnUiState", () => {
  it("完成后 feedback 为 done", () => {
    const notes = extractMelody(track([{ id: "C4", cells: "4" }]), 0);
    expect(learnUiState(notes, 1, "correct").feedback).toBe("done");
  });
});
