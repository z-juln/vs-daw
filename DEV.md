# 开发与发布

日常开发、架构与本地 F5 调试见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)。  
给 AI 的发布硬约束见根目录 [`AGENTS.md`](AGENTS.md)。

## 本地开发（摘要）

```bash
npm install
npm test
npm run compile   # 或 npm run watch
```

F5：`Run VS DAW Extension`（Extension Development Host）。

```bash
npm run package:local
cursor --install-extension vs-daw-0.0.0-local.*.vsix --force
```

本地包仅供自测，**不要**发到 Marketplace / Open VSX。

## 正式发版检查清单

每次发布 **必须** 做完以下全部项：

- [ ]  bump `package.json` → `version`
- [ ]  更新 `CHANGELOG.md`
- [ ]  `npm test` && `npm run package` → `vs-daw-x.y.z.vsix`
- [ ]  Git：commit（如需要）+ **annotated tag** `vX.Y.Z` + **push tag**
- [ ]  **GitHub Release**：创建 release，标题如 `vX.Y.Z`，**上传**对应 VSIX  
      https://github.com/z-juln/vs-daw/releases/new
- [ ]  **VS Code 市场**（Visual Studio Marketplace）上传 / `vsce publish`  
      https://marketplace.visualstudio.com/manage/publishers/vs-daw
- [ ]  **Cursor 市场**（Open VSX）上传 / `ovsx publish`  
      PAT：https://open-vsx.org/user-settings/tokens  
      扩展：https://open-vsx.org/extension/vs-daw/vs-daw
- [ ]  核对两边商店页版本号与 GitHub Latest Release 一致

### 手动入口（收藏）

| 渠道 | 链接 |
|------|------|
| Marketplace 管理（VS Code） | https://marketplace.visualstudio.com/manage/publishers/vs-daw |
| Marketplace 商店页 | https://marketplace.visualstudio.com/items?itemName=vs-daw.vs-daw |
| Open VSX Token（Cursor） | https://open-vsx.org/user-settings/tokens |
| Open VSX 扩展页 | https://open-vsx.org/extension/vs-daw/vs-daw |
| GitHub Releases | https://github.com/z-juln/vs-daw/releases |
| GitHub 新建 Release | https://github.com/z-juln/vs-daw/releases/new |

### CLI 示例

```bash
VERSION=1.0.2   # 换成目标版本
VSIX="vs-daw-${VERSION}.vsix"

npm run package

git tag -a "v${VERSION}" -m "v${VERSION}"
git push origin "v${VERSION}"
gh release create "v${VERSION}" "$VSIX" --title "v${VERSION}" --notes "见 CHANGELOG" --latest

npx @vscode/vsce publish --packagePath "$VSIX" --skip-license -p "$VSCE_PAT"
./node_modules/.bin/ovsx -p "$OVSX_PAT" publish "$VSIX"
```

说明：

- Cursor 扩展搜索走 **Open VSX**，只发微软 Marketplace **不够**。
- 历史品牌包（`cursor-drum-*` / `cursor-daw-*`）仅作 GitHub 归档时可单独 tag；商店正式包始终是 `vs-daw-x.y.z.vsix`。
