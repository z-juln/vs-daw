---
name: writing-vs-daw-scores
description: Use when creating or editing VS DAW `.daw` multi-track session files, drum/keys/guitar/bass/strings/brass/woodwind/pad grids, or MIDI import/export.
---

# 编写 VS DAW 工程

## 核心格式

`.daw` 是 UTF-8 纯文本多轨工程：先写全局头，再按 `track` 分段；每段内每行是一个音高或鼓件，横向每个字符是一个 step，`|` 是小节线且不占 step。

```text
# vs-daw 1
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
program: 0
C4     |x===........x===|
E4     |....x===........|
G4     |........x=======|

track bass
role: bass
program: 32
E2     |x=======x=======|
```

## 快查

文件头：

- `bpm`: 每分钟四分音符数，默认 120。
- `meter`: 拍号，默认 `4/4`。
- `steps`: 每小节格数，默认 16。
- `swing`: 0–100，默认 0。

轨头：

- `track <name>`：开始一条轨。
- `role`: `drums` | `keys` | `guitar` | `bass` | `strings` | `brass` | `woodwind` | `pad`。
- `plugin`: 可选提示（如 `drum.gm` / `keys.gm` / `strings.gm`）。
- `program`: GM 音色号（鼓轨忽略；钢琴 0、吉他 24、贝斯 32、弦乐合奏 48、铜管组 61、长笛 73、Warm Pad 89 等）。均来自内置 `gm.sf3`，换乐器不增大插件体积。

格子：

- `.`、`-`、`·`：休止。
- `1`–`9`：起音力度档（1 最弱，9 最强）——钢琴/表现力优先用数字。
- `o` / `x` / `X`：弱 / 中 / 强（约等于 3 / 6 / 9）。
- `=`：延音（接在起音后；鼓轨忽略）。

鼓件及别名：`kick`/`bd`/`k`，`snare`/`sd`/`sn`，`ch`/`hh`/`hat`，`oh`/`ho`，`clap`/`cp`，`tom1`/`ht`，`tom2`/`mt`，`tom3`/`lt`，`crash`/`cr`，`ride`/`rd`。

音高行：用标准音名，如 `C4`、`Eb3`、`F#2`。

## 编写规则

1. 新文件带完整文件头与至少一条 `track`。
2. 每小节恰好写 `steps` 个格子字符；不要把 `|` 算进去。
3. 同一轨内各行总格数一致；乐器/音高名建议补到 6 字符宽。
4. 修改现有文件时保留注释、小节线和未涉及轨。
5. Agent 直接改文本；Pad 模式供用户键盘演奏（侧边栏选当前轨与八度）。
6. 谱库在 `~/.vs-daw`；`examples/` 按 `demo/`（多轨演示）与 `loops/`（鼓点/节奏 loop：`styles/`、`rhythms/`、`legacy/`）划分。

## 音频与 MIDI

- 播放：工程 → 内存 MIDI → SoundFont（GM SF3）合成。
- 导出：`VS DAW: 导出 MIDI`。
- 导入：`VS DAW: 导入 MIDI` → 写入 `~/.vs-daw`。

## 常见错误

- 不要用 Tab 或格内空格对齐。
- 不要写旧版 `.drum` / `kit:` 头。
- 不要在格子行尾写解释；说明放独立 `#` 注释行。
- 延音 `=` 只能接在起音后；孤立的 `=` 无效。
