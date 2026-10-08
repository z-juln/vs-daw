# Agent 须知（仓库级）

写 `.daw` 工程内容时，仍遵循 [`agent/SKILL.md`](agent/SKILL.md) 与 [`agent/AGENTS.md`](agent/AGENTS.md)。

开发 / 打包细节见 [`DEV.md`](DEV.md)、[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)。

## 发布（强制）

用户要求「发布 / release / 上架 / 发版」时，**不要只打 VSIX 或只 commit**。必须完成下面整条链路（可用 CLI，也可用网页手动）：

1. **升版本**：`package.json` 的 `version` + [`CHANGELOG.md`](CHANGELOG.md)
2. **打包**：`npm run package` → 得到 `vs-daw-x.y.z.vsix`（**禁止**把 `*-local-*.vsix` 发到商店）
3. **GitHub tag + Release**：打 `vX.Y.Z`，创建 Release，并**附上**该 VSIX  
   - 列表：https://github.com/z-juln/vs-daw/releases  
   - 新建：https://github.com/z-juln/vs-daw/releases/new  
4. **VS Code 市场**（Visual Studio Marketplace）  
5. **Cursor 市场**（Open VSX；Cursor 搜扩展走这里，不是微软商店）

缺 PAT 无法 CLI 时：把手动链接发给用户，并说明本地 VSIX 路径，**不要假装已上架**。

## 手动发布链接（发给用户时请原样提供）

| 渠道 | 用途 | 链接 |
|------|------|------|
| **VS Code / Marketplace** | Publisher 管理 / 上传 VSIX | https://marketplace.visualstudio.com/manage/publishers/vs-daw |
| **VS Code / Marketplace** | 商店页（核对版本） | https://marketplace.visualstudio.com/items?itemName=vs-daw.vs-daw |
| **Cursor / Open VSX** | 创建 PAT | https://open-vsx.org/user-settings/tokens |
| **Cursor / Open VSX** | 扩展页（核对版本） | https://open-vsx.org/extension/vs-daw/vs-daw |
| **GitHub Releases** | 列表 | https://github.com/z-juln/vs-daw/releases |
| **GitHub Releases** | 新建 Release | https://github.com/z-juln/vs-daw/releases/new |

扩展 ID：`vs-daw.vs-daw`。Publisher / Open VSX namespace：`vs-daw`。

## CLI 速查（有令牌时）

```bash
# GitHub Release（需 gh 已登录）
git tag -a "vX.Y.Z" -m "vX.Y.Z"
git push origin "vX.Y.Z"
gh release create "vX.Y.Z" "vs-daw-X.Y.Z.vsix" --title "vX.Y.Z" --notes-file CHANGELOG.md --latest

# VS Marketplace
npx @vscode/vsce publish --packagePath "vs-daw-X.Y.Z.vsix" --skip-license -p "$VSCE_PAT"

# Open VSX（Cursor）
./node_modules/.bin/ovsx -p "$OVSX_PAT" publish "vs-daw-X.Y.Z.vsix"
```

令牌来源：Azure DevOps PAT（Marketplace → Manage）→ `VSCE_PAT`；Open VSX → `OVSX_PAT`。**不要把 PAT 写进仓库或文档。**
