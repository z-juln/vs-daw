---
name: writing-vs-daw-scores
description: Use when creating or editing VS DAW `.daw` multi-track session files (text or zip package), sample tracks, drum/keys/guitar/bass/strings/brass/woodwind/lead/pad/ethnic/fx grids, or MIDI import/export.
---

# 编写 VS DAW 工程

## 核心格式

`.daw` 可以是：

1. **纯文本**：UTF-8 多轨工程。
2. **DAW 包**：zip（仍用 `.daw` 后缀），结构固定为：

```text
song.daw          # zip
├── index.daw     # 必选：文本工程
└── assets/       # 采样与其它资源
    └── kick.wav
```

文本工程先写全局头，再按 `track` 分段；每段内每行是一个音高、鼓件或采样路径，横向每个字符是一个 step，`|` 是小节线且不占 step。

```text
# vs-daw 2
bpm: 120
meter: 4/4
steps: 16
swing: 0

track drums
role: drums
kick   |x...x...x...x...|
snare  |....x.......x...|
ch     |x.x.x.x.x.x.x.x.|

track piano
role: keys
program: 1
C4     |x===........x===|
E4     |....x===........|
G4     |........x=======|

track bass
role: bass
program: 33
E2     |x=======x=======|
```

## 快查

文件头：

- `# vs-daw 2`：当前格式版本（新文件请写 **2**）。
- `bpm`: 每分钟四分音符数，默认 120。
- `meter`: 拍号，默认 `4/4`。
- `steps`: 每小节格数，默认 16。
- `swing`: 0–100，默认 0。

轨头：

- `track <name>`：开始一条轨。
- `role`: `drums` | `keys` | `guitar` | `bass` | `strings` | `brass` | `woodwind` | `lead` | `pad` | `ethnic` | `fx` | `sample`。
- `plugin`: 可选提示（如 `drum.gm` / `keys.gm` / `strings.gm` / `ethnic.gm` / `sample.file`）。
- `channel`: 1–16（文件里从 1 起；与 Cubase 通道号一致）。
- `program`: **1–128**（与 Cubase / FL Studio 面板一致；**不是** MIDI 线缆上的 0–127）。
  - 大钢琴=`1`，尼龙吉他=`25`，原声贝斯=`33`，弦乐合奏=`49`，铜管组=`62`，长笛=`74`，Square Lead=`81`，Warm Pad=`90`，卡林巴=`109`，风笛=`110`，Crystal=`99`。
  - `ethnic` 文件号 **105–112**（西塔琴…唢呐）；默认卡林巴 **109**。
  - `lead` 文件号 **81–88**；`fx` 为 **97–104** 与 **113–128**。
  - 侧边栏「切换乐器」两级选具体音色时，写入的也是这套 **1–128**。

### ⚠️ Agent 易错：`program` 编号

| 场景 | 大钢琴 | 卡林巴 | 风笛 |
|------|--------|--------|------|
| **`.daw` / UI（本项目）** | `1` | `109` | `110` |
| MIDI 协议 / SoundFont 内部 | `0` | `108` | `109` |

- **写 `.daw` 时一律用 1–128**，不要写 `program: 0`。
- 从 GM 规格表（0–127）抄号时 **加 1**；从 Cubase/FL 面板抄号时 **原样写入**。
- 旧文件 `# vs-daw 1` 仍按 0–127 读取；保存后会升为 `# vs-daw 2` 并改成 1–128。不要把 v1 的数字直接贴进 v2 工程。

采样轨示例（路径相对包根；纯文本工程则相对 `.daw` 所在目录）：

```text
track samples
role: sample
offset: -0.05
assets/kick.wav   |x.......x.......|
assets/vocal.wav offset:-0.12  |....4===========|
```

- 轨级 `offset:` / 行级 `offset:`：采样触发时间偏移（**秒**，可负）。负=提前，正=延后。
- 行级覆盖轨级；网格编辑器在采样轨工具栏可改轨级偏移。

格子：

- `.`、`-`、`·`：休止。
- `1`–`9`：起音力度档（1 最弱，9 最强）——钢琴/表现力优先用数字。
- `o` / `x` / `X`：弱 / 中 / 强（约等于 3 / 6 / 9）。
- `=`：延音（接在起音后；鼓轨忽略）。

鼓件及别名：`kick`/`bd`/`k`，`snare`/`sd`/`sn`，`ch`/`hh`/`hat`，`oh`/`ho`，`clap`/`cp`，`tom1`/`ht`，`tom2`/`mt`，`tom3`/`lt`，`crash`/`cr`，`ride`/`rd`。

音高行：用标准音名，如 `C4`、`Eb3`、`F#2`。

## 编写规则

1. 新文件带 `# vs-daw 2` 完整文件头与至少一条 `track`。
2. 每小节恰好写 `steps` 个格子字符；不要把 `|` 算进去。
3. 同一轨内各行总格数一致；乐器/音高名建议补到 6 字符宽。
4. 修改现有文件时保留注释、小节线和未涉及轨。
5. Agent 直接改文本；Pad 模式供用户键盘演奏（侧边栏选当前轨与八度）。

## 播放与导出

- 播放：GM 轨 → 内存 MIDI → SoundFont（GM SF3）；`role: sample` → 触发 `assets/` 等采样文件并混音。
- 导出：`VS DAW: 导出 MIDI`。若含采样轨，会提示「采样只能留在 .daw 包里」，确认后跳过采样轨导出。
