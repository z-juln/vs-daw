# 开发说明

面向贡献者 / 本地打包。用户使用说明见根目录 [README.md](../README.md)。  
**发版清单**（GitHub Release + VS Marketplace + Open VSX）见根目录 [DEV.md](../DEV.md)；AI 须遵循 [AGENTS.md](../AGENTS.md)。

## 架构要点

- `.daw` 文本 → `parseSession` → 调度为 MIDI 事件 → `spessasynth_core` + 内置 GM SoundFont（`media/soundfonts/gm.sf3`）合成 PCM
- 扩展宿主内出声（`node-web-audio-api`），不调用系统播放器
- 侧边栏：播放列表 / 键盘录制为 Webview；创建仍为 TreeView
- Agent 格式约定：`agent/SKILL.md`；设计与计划草案：`docs/superpowers/`

## 本地开发

```bash
npm install
npm test
npm run compile
```

- **推荐**：Cursor / VS Code 里 F5（`Run VS DAW Extension`）开 Extension Development Host，不覆盖已安装的商店版
- 监听编译：`npm run watch`

## 打包与安装

打包前会拉取 / 校验 SoundFont（约 38MB）：

```bash
npm run fetch:sf2      # 仅下载音源
npm run package        # 正式包（与 package.json version 一致，可发商店）
npm run package:local  # 本地测试包：version=0.0.0-local.*，displayName 带 (Local)
```

- **正式包** `vs-daw-x.y.z.vsix`：发给用户 / 上传 Marketplace、Open VSX
- **本地包** `vs-daw-0.0.0-local.*.vsix`：`cursor --install-extension … --force` 装进当前编辑器；扩展 id 仍是 `vs-daw.vs-daw`，商店出现**更高**正式版本后可以自动/手动更新覆盖。不要把 local 包发到商店。

生成后：**Install from VSIX**，或：

```bash
cursor --install-extension vs-daw-0.0.0-local.*.vsix --force
```

## 常用路径

| 路径 | 说明 |
|------|------|
| `src/extension.ts` | 激活、Transport、Pad、命令 |
| `src/sidebar/` | 播放列表 / 录制 / 创建 |
| `src/padLayout.ts` | 音高 Pad 键位 |
| `src/library.ts` | `~/.vs-daw` 谱库 |
| `examples/` | 随扩展同步到谱库的示例 |
| `media/soundfonts/` | GM SoundFont（体积大，勿手改进 git 大文件策略外） |

## 相关文档

- 产品设计 / 实施计划：`docs/superpowers/specs/`、`docs/superpowers/plans/`
- 给 AI 写谱的格式手册：`agent/SKILL.md`
