# 学习旋律模式 — 实现计划

## 文件

| 文件 | 职责 |
|------|------|
| `src/melodyLearn.ts` | `extractMelody` / `learnUiState` |
| `tests/melodyLearn.test.ts` | 单测 |
| `src/extension.ts` | 开关、Pad 判题、seek |
| `src/gridEditor/DawGridEditorProvider.ts` | `broadcastLearn`、工具栏按钮、浮层 HTML |
| `media/gridEditor.js` / `.css` | 悬浮条与高亮 |
| `package.json` | `vsDaw.toggleMelodyLearn` |

## 状态

已实现（见上述文件）。
