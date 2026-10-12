# VS DAW Agent 说明

本项目的 `.daw` 可以是纯文本，或 zip 包（`index.daw` + `assets/`）。文本工程为多轨 step 网格（鼓 / 钢琴 / 弦乐 / `role: sample` 等），延音用 `=`。

**`program:` 用 1–128**（大钢琴=`1`，卡林巴=`109`），与 Cubase/FL 一致；勿写 MIDI 内部的 0–127。详见 [`SKILL.md`](SKILL.md)。

编写或修改工程时，遵循同目录 `SKILL.md`。不要写旧版 `.drum` 或 `kit:` 头。

仓库级约束（含**发版必须上 GitHub Release + VS Marketplace + Open VSX**、手动商店链接）见根目录 [`AGENTS.md`](../AGENTS.md)。
