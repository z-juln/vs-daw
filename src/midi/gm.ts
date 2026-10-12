import { TrackRole } from "../types";

export const TRACK_ROLES: TrackRole[] = [
  "drums",
  "keys",
  "guitar",
  "bass",
  "strings",
  "brass",
  "woodwind",
  "lead",
  "pad",
  "ethnic",
  "fx",
  "sample",
];

export const ROLE_LABEL_ZH: Record<TrackRole, string> = {
  drums: "鼓",
  keys: "钢琴",
  guitar: "吉他",
  bass: "贝斯",
  strings: "弦乐",
  brass: "铜管",
  woodwind: "木管",
  lead: "合成 Lead",
  pad: "合成 Pad",
  ethnic: "民族乐器",
  fx: "音效 / 打击",
  sample: "采样",
};

export const DEFAULT_PLUGIN: Record<TrackRole, string> = {
  drums: "drum.gm",
  keys: "keys.gm",
  guitar: "gtr.gm",
  bass: "bass.gm",
  strings: "strings.gm",
  brass: "brass.gm",
  woodwind: "woodwind.gm",
  lead: "lead.gm",
  pad: "pad.gm",
  ethnic: "ethnic.gm",
  fx: "fx.gm",
  sample: "sample.file",
};

export const DEFAULT_PROGRAM: Record<TrackRole, number> = {
  drums: 0,
  keys: 0, // Acoustic Grand Piano
  guitar: 24, // Nylon Guitar
  bass: 32, // Acoustic Bass
  strings: 48, // String Ensemble 1
  brass: 61, // Brass Section
  woodwind: 73, // Flute
  lead: 80, // Lead 1 (Square)
  pad: 89, // Warm Pad
  ethnic: 108, // Kalimba
  fx: 98, // Crystal
  sample: 0,
};

/** 0-based MIDI channels; drums use channel 10 → index 9. */
export const DEFAULT_CHANNEL: Record<TrackRole, number> = {
  drums: 9,
  keys: 0,
  guitar: 1,
  bass: 2,
  strings: 3,
  brass: 4,
  woodwind: 5,
  lead: 8,
  pad: 6,
  ethnic: 10,
  fx: 11,
  sample: 7,
};

/** Pad 默认八度（低排起始）。 */
export const DEFAULT_OCTAVE: Record<TrackRole, number> = {
  drums: 4,
  keys: 3,
  guitar: 2,
  bass: 1,
  strings: 3,
  brass: 3,
  woodwind: 4,
  lead: 4,
  pad: 3,
  ethnic: 4,
  fx: 3,
  sample: 4,
};

export const DRUM_TO_GM: Record<string, number> = {
  kick: 36,
  snare: 38,
  ch: 42,
  oh: 46,
  clap: 39,
  tom1: 50,
  tom2: 47,
  tom3: 45,
  crash: 49,
  ride: 51,
};

export const GM_TO_DRUM: Record<number, string> = Object.fromEntries(
  Object.entries(DRUM_TO_GM).map(([id, note]) => [note, id]),
);

export function roleFromProgram(program: number, channel: number): TrackRole {
  if (channel === 9) return "drums";
  if (program >= 24 && program <= 31) return "guitar";
  if (program >= 32 && program <= 39) return "bass";
  if (program >= 40 && program <= 55) return "strings";
  if (program >= 56 && program <= 63) return "brass";
  if (program >= 64 && program <= 79) return "woodwind";
  if (program >= 80 && program <= 87) return "lead";
  if (program >= 88 && program <= 95) return "pad";
  if (program >= 104 && program <= 111) return "ethnic";
  if (
    (program >= 96 && program <= 103)
    || (program >= 112 && program <= 127)
  ) {
    return "fx";
  }
  return "keys";
}

/** GM 旋律音色中文名（0–127）；鼓组不在此表。 */
export const GM_PROGRAM_LABEL_ZH: readonly string[] = [
  "大钢琴", "亮音钢琴", "电钢琴", "酒吧钢琴", "电钢琴 1", "电钢琴 2", "大键琴", "古钢琴",
  "钢片琴", "钟琴", "音乐盒", "颤音琴", "马林巴", "木琴", "管钟", "杜西玛琴",
  "击杆风琴", "打击风琴", "摇滚风琴", "教堂管风琴", "簧片风琴", "手风琴", "口琴", "探戈手风琴",
  "尼龙弦吉他", "钢弦吉他", "爵士电吉他", "清音电吉他", "闷音电吉他", "过载电吉他", "失真电吉他", "吉他和声",
  "原声贝斯", "指弹电贝斯", "拨片电贝斯", "无品贝斯", "掌击贝斯 1", "掌击贝斯 2", "合成贝斯 1", "合成贝斯 2",
  "小提琴", "中提琴", "大提琴", "低音提琴", "颤音弦乐", "拨弦", "竖琴", "定音鼓",
  "弦乐合奏 1", "弦乐合奏 2", "合成弦乐 1", "合成弦乐 2", "合唱啊音", "嗓音嘟音", "合成嗓音", "管弦乐打击",
  "小号", "长号", "大号", "弱音小号", "圆号", "铜管组", "合成铜管 1", "合成铜管 2",
  "高音萨克斯", "中音萨克斯", "次中音萨克斯", "上低音萨克斯", "双簧管", "英国管", "大管", "单簧管",
  "短笛", "长笛", "竖笛", "排笛", "瓶吹", "尺八", "口哨", "奥卡里娜",
  "方波 Lead", "锯齿 Lead", "汽笛 Lead", "碎音 Lead", "查拉昂 Lead", "人声 Lead", "五度 Lead", "贝斯+Lead",
  "新世纪 Pad", "暖音 Pad", "多合成 Pad", "合唱 Pad", "弓弦 Pad", "金属 Pad", "光晕 Pad", "扫频 Pad",
  "冰雨", "音轨", "水晶", "大气", "明亮", "妖精", "回声", "星际",
  "西塔琴", "班卓", "三味线", "古筝", "卡林巴", "风笛", "提琴", "唢呐",
  "铃铛", "阿哥戈", "钢鼓", "木块", "太鼓", "旋律通通鼓", "合成鼓", "反向镲",
  "品噪声", "气息噪声", "海浪", "鸟鸣", "电话铃", "直升机", "掌声", "枪声",
];

export interface GmInstrument {
  program: number;
  label: string;
}

/** 某轨角色下可选的具体 GM 音色（鼓 / 采样无子项）。 */
export function instrumentsForRole(role: TrackRole): GmInstrument[] {
  if (role === "drums" || role === "sample") return [];
  const ranges: Array<[number, number]> =
    role === "keys" ? [[0, 23]]
      : role === "guitar" ? [[24, 31]]
        : role === "bass" ? [[32, 39]]
          : role === "strings" ? [[40, 55]]
            : role === "brass" ? [[56, 63]]
              : role === "woodwind" ? [[64, 79]]
                : role === "lead" ? [[80, 87]]
                  : role === "pad" ? [[88, 95]]
                    : role === "ethnic" ? [[104, 111]]
                      : role === "fx" ? [[96, 103], [112, 127]]
                        : [];
  const list: GmInstrument[] = [];
  for (const [from, to] of ranges) {
    for (let program = from; program <= to; program += 1) {
      list.push({
        program,
        label: GM_PROGRAM_LABEL_ZH[program] ?? `Program ${program}`,
      });
    }
  }
  return list;
}

export function programLabel(program: number): string {
  if (!Number.isInteger(program) || program < 0 || program > 127) return `Program ${program}`;
  return GM_PROGRAM_LABEL_ZH[program] ?? `Program ${program}`;
}

/**
 * 写进 `.daw` / UI 的音色号（1–128，与 Cubase / FL Studio 一致）。
 * 内存与 MIDI Program Change 仍用 0–127。
 */
export function programUiNumber(program: number): number {
  if (!Number.isInteger(program) || program < 0 || program > 127) return program;
  return program + 1;
}

export function isPitchRole(role: TrackRole): boolean {
  return role !== "drums" && role !== "sample";
}

export function isSampleRole(role: TrackRole): boolean {
  return role === "sample";
}
