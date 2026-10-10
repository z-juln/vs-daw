import * as vscode from "vscode";
import {
  isDawPackageFile,
  listPackageChildren,
  loadPackageEntries,
  PACKAGE_INDEX,
} from "../dawPackage";
import {
  createLibraryFolder,
  createLibraryScore,
  listLibraryDirectory,
  renameLibraryEntry,
  sanitizeFolderSegment,
  sanitizeScoreName,
} from "../library";
import { emptyTemplate } from "../serialize";
import {
  isPlayingScore,
  PlaylistViewState,
  scoreContextValue,
} from "./scoreContext";

export type { PlaylistViewState } from "./scoreContext";

export type PlaylistNodeKind =
  | "folder"
  | "score"
  | "package"
  | "packageFolder"
  | "packageFile";

/** 命令参数：Webview 可序列化引用。 */
export interface PlaylistRef {
  kind: PlaylistNodeKind;
  relativePath: string;
  absolutePath: string;
  /** DAW 包（zip）绝对路径 */
  packagePath?: string;
  /** 包内相对路径，如 index.daw / assets/kick.wav */
  entryPath?: string;
}

const PACKAGE_KINDS: PlaylistNodeKind[] = ["package", "packageFolder", "packageFile"];

export function isPlaylistRef(value: unknown): value is PlaylistRef {
  if (!value || typeof value !== "object") return false;
  const item = value as PlaylistRef;
  const kindOk = item.kind === "folder"
    || item.kind === "score"
    || PACKAGE_KINDS.includes(item.kind);
  return (
    kindOk
    && typeof item.relativePath === "string"
    && typeof item.absolutePath === "string"
  );
}

export function asPlaylistRef(value: unknown): PlaylistRef | undefined {
  if (isPlaylistRef(value)) return value;
  if (!value || typeof value !== "object") return undefined;
  const item = value as PlaylistRef;
  if (typeof item.relativePath !== "string" || typeof item.absolutePath !== "string") {
    return undefined;
  }
  const kind: PlaylistNodeKind = item.relativePath.toLowerCase().endsWith(".daw")
    ? "score"
    : "folder";
  return {
    kind,
    relativePath: item.relativePath,
    absolutePath: item.absolutePath,
    packagePath: typeof item.packagePath === "string" ? item.packagePath : undefined,
    entryPath: typeof item.entryPath === "string" ? item.entryPath : undefined,
  };
}

export function packageEntryKey(packageRelativePath: string, entryPath: string): string {
  return `${packageRelativePath}!/${entryPath}`;
}

export function dropTargetFolder(target: PlaylistRef | undefined): string {
  if (!target) return "";
  if (target.kind === "folder") return target.relativePath;
  const bang = target.relativePath.indexOf("!/");
  if (bang >= 0) return parentOfPath(target.relativePath.slice(0, bang));
  return parentOfPath(target.relativePath);
}

/** 相对路径的父目录（不含自身）。 */
export function parentOfPath(relativePath: string): string {
  const idx = relativePath.lastIndexOf("/");
  return idx >= 0 ? relativePath.slice(0, idx) : "";
}

interface TreeNode {
  kind: PlaylistNodeKind;
  name: string;
  relativePath: string;
  absolutePath: string;
  playing: boolean;
  playState: string;
  packagePath?: string;
  entryPath?: string;
  children?: TreeNode[];
  /** 可展开（目录或 DAW 包） */
  expandable?: boolean;
  /** 双击/回车是否允许打开 */
  openable?: boolean;
}

type InlineDraft =
  | { mode: "create-folder" | "create-score"; parent: string; seed: string }
  | { mode: "rename"; ref: PlaylistRef; seed: string };

export class PlaylistProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private readonly expanded = new Set<string>();
  private draft?: InlineDraft;
  private openScore: (absolutePath: string) => Promise<void> = async () => {};
  private scoreDefaults: () => { bpm: number; bars: number } = () => ({ bpm: 120, bars: 4 });

  constructor(
    private readonly root: string,
    private readonly getState: () => PlaylistViewState,
    private readonly extensionUri: vscode.Uri,
  ) {}

  configure(options: {
    openScore: (absolutePath: string) => Promise<void>;
    scoreDefaults: () => { bpm: number; bars: number };
  }): void {
    this.openScore = options.openScore;
    this.scoreDefaults = options.scoreDefaults;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    const codiconsRoot = vscode.Uri.joinPath(
      this.extensionUri,
      "node_modules",
      "@vscode",
      "codicons",
      "dist",
    );
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [codiconsRoot],
    };
    webviewView.webview.html = this.shellHtml(
      webviewView.webview.asWebviewUri(vscode.Uri.joinPath(codiconsRoot, "codicon.css")),
    );
    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (!message || typeof message !== "object") return;
      if (message.type === "ready") {
        await this.pushTree();
        return;
      }
      if (message.type === "toggle" && typeof message.path === "string") {
        if (this.expanded.has(message.path)) this.expanded.delete(message.path);
        else this.expanded.add(message.path);
        await this.pushTree();
        return;
      }
      if (message.type === "collapseAll") {
        this.expanded.clear();
        await this.pushTree();
        return;
      }
      if (message.type === "inlineCancel") {
        this.draft = undefined;
        await this.pushTree();
        return;
      }
      if (message.type === "inlineCommit" && typeof message.value === "string") {
        await this.commitInline(message.value);
        return;
      }
      if (message.type === "command" && typeof message.command === "string") {
        await vscode.commands.executeCommand(message.command, ...(message.args ?? []));
      }
    });
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) void this.pushTree();
    });
  }

  refresh(): void {
    void this.pushTree();
  }

  collapseAll(): void {
    this.expanded.clear();
    void this.pushTree();
  }

  beginCreateFolder(parent: string): void {
    if (parent) this.expanded.add(parent);
    this.draft = { mode: "create-folder", parent, seed: "" };
    void this.pushTree();
  }

  beginCreateScore(parent: string): void {
    if (parent) this.expanded.add(parent);
    this.draft = { mode: "create-score", parent, seed: "" };
    void this.pushTree();
  }

  beginRename(ref: PlaylistRef): void {
    if (ref.kind === "packageFolder" || ref.kind === "packageFile") return;
    const name = ref.relativePath.split("/").pop() ?? ref.relativePath;
    const seed = ref.kind === "folder" ? name : name.replace(/\.daw$/i, "");
    const parent = parentOfPath(ref.relativePath);
    if (parent) this.expanded.add(parent);
    this.draft = { mode: "rename", ref, seed };
    void this.pushTree();
  }

  private async commitInline(raw: string): Promise<void> {
    const draft = this.draft;
    if (!draft) return;
    try {
      if (draft.mode === "create-folder") {
        const name = sanitizeFolderSegment(raw);
        const relativePath = draft.parent ? `${draft.parent}/${name}` : name;
        await createLibraryFolder(this.root, relativePath);
        this.expanded.add(relativePath);
      } else if (draft.mode === "create-score") {
        const name = sanitizeScoreName(raw);
        const defaults = this.scoreDefaults();
        const target = await createLibraryScore(
          this.root,
          name,
          emptyTemplate({ bpm: defaults.bpm, bars: defaults.bars }),
          { folder: draft.parent },
        );
        await this.openScore(target);
      } else if (draft.mode === "rename") {
        const isFolder = draft.ref.kind === "folder";
        const nextName = isFolder ? sanitizeFolderSegment(raw) : sanitizeScoreName(raw);
        const parent = parentOfPath(draft.ref.relativePath);
        const nextRelative = parent ? `${parent}/${nextName}` : nextName;
        // 未改名：直接退出编辑，不触发移动/重命名
        if (nextRelative !== draft.ref.relativePath) {
          await renameLibraryEntry(this.root, draft.ref.relativePath, nextRelative);
        }
      }
      this.draft = undefined;
      await this.pushTree();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        void vscode.window.showWarningMessage("已存在同名项，请换一个名称");
      } else {
        void vscode.window.showErrorMessage(`操作失败：${(error as Error).message}`);
      }
      await this.pushTree();
    }
  }

  private async pushTree(): Promise<void> {
    if (!this.view) return;
    const tree = await this.buildTree("");
    const draft = this.draft;
    void this.view.webview.postMessage({
      type: "tree",
      tree,
      expanded: [...this.expanded],
      draft: draft
        ? draft.mode === "rename"
          ? {
            mode: "rename",
            parent: parentOfPath(draft.ref.relativePath),
            path: draft.ref.relativePath,
            kind: draft.ref.kind,
            seed: draft.seed,
          }
          : {
            mode: draft.mode,
            parent: draft.parent,
            kind: draft.mode === "create-folder" ? "folder" : "score",
            seed: draft.seed,
          }
        : null,
    });
  }

  private async buildTree(relativeDir: string): Promise<TreeNode[]> {
    const state = this.getState();
    const listing = await listLibraryDirectory(this.root, relativeDir);
    const nodes: TreeNode[] = [];
    for (const folder of listing.folders) {
      const children = this.expanded.has(folder.relativePath)
        ? await this.buildTree(folder.relativePath)
        : undefined;
      nodes.push({
        kind: "folder",
        name: folder.name,
        relativePath: folder.relativePath,
        absolutePath: folder.absolutePath,
        playing: false,
        playState: "vsDaw.folder",
        expandable: true,
        openable: false,
        children,
      });
    }
    for (const score of listing.scores) {
      const isPackage = await isDawPackageFile(score.absolutePath);
      if (isPackage) {
        const children = this.expanded.has(score.relativePath)
          ? await this.buildPackageTree(score.relativePath, score.absolutePath, "")
          : undefined;
        nodes.push({
          kind: "package",
          name: score.name,
          relativePath: score.relativePath,
          absolutePath: score.absolutePath,
          packagePath: score.absolutePath,
          playing: isPlayingScore(score.absolutePath, state),
          playState: scoreContextValue(score.absolutePath, state),
          expandable: true,
          openable: false,
          children,
        });
        continue;
      }
      nodes.push({
        kind: "score",
        name: score.name,
        relativePath: score.relativePath,
        absolutePath: score.absolutePath,
        playing: isPlayingScore(score.absolutePath, state),
        playState: scoreContextValue(score.absolutePath, state),
        expandable: false,
        openable: true,
      });
    }
    return nodes;
  }

  private async buildPackageTree(
    packageRelativePath: string,
    packageAbsolutePath: string,
    entryDir: string,
  ): Promise<TreeNode[]> {
    const files = await loadPackageEntries(packageAbsolutePath);
    const children = listPackageChildren(files, entryDir);
    const nodes: TreeNode[] = [];
    for (const child of children) {
      const name = child.path.split("/").pop() ?? child.path;
      const relativePath = packageEntryKey(packageRelativePath, child.path);
      if (child.directory) {
        const nested = this.expanded.has(relativePath)
          ? await this.buildPackageTree(packageRelativePath, packageAbsolutePath, child.path)
          : undefined;
        nodes.push({
          kind: "packageFolder",
          name,
          relativePath,
          absolutePath: packageAbsolutePath,
          packagePath: packageAbsolutePath,
          entryPath: child.path,
          playing: false,
          playState: "vsDaw.folder",
          expandable: true,
          openable: false,
          children: nested,
        });
      } else {
        nodes.push({
          kind: "packageFile",
          name,
          relativePath,
          absolutePath: packageAbsolutePath,
          packagePath: packageAbsolutePath,
          entryPath: child.path,
          playing: false,
          playState: "vsDaw.packageFile",
          expandable: false,
          openable: true,
        });
      }
    }
    // Prefer index.daw first visually among root files
    if (!entryDir) {
      nodes.sort((a, b) => {
        if (a.entryPath === PACKAGE_INDEX) return -1;
        if (b.entryPath === PACKAGE_INDEX) return 1;
        return 0;
      });
    }
    return nodes;
  }

  private shellHtml(codiconsCss: vscode.Uri): string {
    const csp = [
      "default-src 'none'",
      `style-src ${this.view!.webview.cspSource} 'unsafe-inline'`,
      `font-src ${this.view!.webview.cspSource}`,
      "script-src 'unsafe-inline'",
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<link href="${codiconsCss}" rel="stylesheet" />
<style>
  html, body {
    height: 100%;
    margin: 0;
    padding: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-sideBar-foreground, var(--vscode-foreground));
    background: var(--vscode-sideBar-background);
    user-select: none;
  }
  #root {
    min-height: 100%;
    box-sizing: border-box;
    padding-bottom: 16px;
    outline: none;
  }
  .row {
    display: flex;
    align-items: center;
    height: 22px;
    padding-right: 8px;
    cursor: default;
  }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .row.selected {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }
  .row.drop-target {
    background: var(--vscode-list-dropBackground, var(--vscode-list-hoverBackground));
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  .row.editing {
    background: transparent;
    color: var(--vscode-sideBar-foreground, var(--vscode-foreground));
  }
  .twist, .icon {
    width: 16px;
    height: 22px;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .twist { margin-right: 2px; }
  .twist.empty { visibility: hidden; }
  .twist .codicon {
    font-size: 12px;
    line-height: 12px;
    opacity: 0.85;
  }
  .icon .codicon, .play .codicon {
    font-size: 16px;
    line-height: 16px;
  }
  .icon-folder { color: #dcb67a; }
  .row.selected .icon-folder { color: #dcb67a; }
  .icon-music { color: var(--vscode-icon-foreground); }
  .row.selected .icon-music,
  .row.selected .twist .codicon {
    color: var(--vscode-list-activeSelectionForeground);
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-left: 6px;
  }
  .desc {
    margin-left: 8px;
    opacity: 0.7;
    font-size: 11px;
  }
  .play {
    flex: none;
    width: 22px;
    height: 22px;
    margin-left: 2px;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    padding: 0;
  }
  .row:hover .play,
  .row.selected .play,
  .play.on { opacity: 1; }
  .play:hover { background: var(--vscode-toolbar-hoverBackground); }
  .inline-input {
    flex: 1;
    min-width: 0;
    height: 20px;
    margin: 0 4px 0 6px;
    padding: 0 4px;
    border: 1px solid var(--vscode-focusBorder);
    border-radius: 0;
    outline: none;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    font: inherit;
  }
  .empty-hint {
    padding: 16px;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    line-height: 1.5;
  }
  #menu {
    position: fixed;
    z-index: 100;
    min-width: 180px;
    margin: 0;
    padding: 4px 0;
    list-style: none;
    background: var(--vscode-menu-background);
    color: var(--vscode-menu-foreground);
    border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border));
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.36);
    display: none;
  }
  #menu li {
    padding: 4px 20px;
    cursor: default;
    white-space: nowrap;
  }
  #menu li:hover {
    background: var(--vscode-menu-selectionBackground);
    color: var(--vscode-menu-selectionForeground);
  }
  #menu li.sep {
    height: 1px;
    margin: 4px 0;
    padding: 0;
    background: var(--vscode-menu-separatorBackground, var(--vscode-widget-border));
  }
  #menu li.sep:hover {
    background: var(--vscode-menu-separatorBackground, var(--vscode-widget-border));
  }
</style>
</head>
<body>
<div id="root" tabindex="0"></div>
<ul id="menu"></ul>
<script>
const vscode = acquireVsCodeApi();
let tree = [];
let expanded = new Set();
let draft = null;
let dragPaths = [];
let committing = false;
let selectedPath = '';
let selectedKind = '';
let nodeByPath = new Map();

const rootEl = document.getElementById('root');
const menuEl = document.getElementById('menu');
const DEPTH_PX = 8;
const BASE_PAD = 4;

function rowPad(depth) {
  return BASE_PAD + depth * DEPTH_PX;
}

function codicon(name, extraClass) {
  const span = document.createElement('span');
  span.className = 'codicon codicon-' + name + (extraClass ? ' ' + extraClass : '');
  return span;
}

function selectRow(path, kind) {
  selectedPath = path || '';
  selectedKind = kind || '';
  for (const el of rootEl.querySelectorAll('.row.selected')) el.classList.remove('selected');
  if (!selectedPath) return;
  const safe = (window.CSS && CSS.escape) ? CSS.escape(selectedPath) : selectedPath.replace(/"/g, '\\\\"');
  const row = rootEl.querySelector('.row[data-path="' + safe + '"]');
  if (row) row.classList.add('selected');
  rootEl.focus();
}

function cmd(command, ...args) {
  vscode.postMessage({ type: 'command', command, args });
}

function hideMenu() {
  menuEl.style.display = 'none';
  menuEl.innerHTML = '';
}

function showMenu(x, y, items) {
  menuEl.innerHTML = '';
  for (const item of items) {
    const li = document.createElement('li');
    if (item === '-') {
      li.className = 'sep';
    } else {
      li.textContent = item.label;
      li.onclick = (e) => {
        e.stopPropagation();
        hideMenu();
        item.run();
      };
    }
    menuEl.appendChild(li);
  }
  menuEl.style.display = 'block';
  const pad = 4;
  const maxX = window.innerWidth - menuEl.offsetWidth - pad;
  const maxY = window.innerHeight - menuEl.offsetHeight - pad;
  menuEl.style.left = Math.max(pad, Math.min(x, maxX)) + 'px';
  menuEl.style.top = Math.max(pad, Math.min(y, maxY)) + 'px';
}

function refOf(node) {
  return {
    kind: node.kind,
    relativePath: node.relativePath,
    absolutePath: node.absolutePath,
    packagePath: node.packagePath,
    entryPath: node.entryPath,
  };
}

function isExpandable(node) {
  return Boolean(node.expandable || node.kind === 'folder' || node.kind === 'package' || node.kind === 'packageFolder');
}

function isOpenable(node) {
  if (node.openable === false) return false;
  return node.kind === 'score' || node.kind === 'packageFile';
}

function folderMenus(node) {
  return [
    { label: '在此目录创建工程', run: () => cmd('vsDaw.newScoreInFolder', refOf(node)) },
    { label: '新建子目录', run: () => cmd('vsDaw.createLibraryFolder', refOf(node)) },
    '-',
    { label: '重命名', run: () => cmd('vsDaw.renameLibraryItem', refOf(node)) },
    { label: '删除', run: () => cmd('vsDaw.deleteLibraryFolder', refOf(node)) },
  ];
}

function scoreMenus(node) {
  const items = [];
  if (node.playState === 'vsDaw.scorePlaying') {
    items.push({ label: '暂停', run: () => cmd('vsDaw.pauseLibraryScore', refOf(node)) });
  } else {
    items.push({ label: '播放', run: () => cmd('vsDaw.playLibraryScore', refOf(node)) });
  }
  items.push(
    { label: '打开', run: () => cmd('vsDaw.openLibraryScore', refOf(node)) },
    { label: '转为采样包…', run: () => cmd('vsDaw.convertToPackage', refOf(node)) },
    '-',
    { label: '重命名', run: () => cmd('vsDaw.renameLibraryItem', refOf(node)) },
    { label: '删除', run: () => cmd('vsDaw.deleteLibraryScore', refOf(node)) },
  );
  return items;
}

function packageMenus(node) {
  const items = [];
  if (node.playState === 'vsDaw.scorePlaying') {
    items.push({ label: '暂停', run: () => cmd('vsDaw.pauseLibraryScore', refOf(node)) });
  } else {
    items.push({ label: '播放', run: () => cmd('vsDaw.playLibraryScore', refOf(node)) });
  }
  items.push(
    { label: '展开/折叠', run: () => vscode.postMessage({ type: 'toggle', path: node.relativePath }) },
    '-',
    { label: '重命名', run: () => cmd('vsDaw.renameLibraryItem', refOf(node)) },
    { label: '删除', run: () => cmd('vsDaw.deleteLibraryScore', refOf(node)) },
  );
  return items;
}

function packageEntryMenus(node) {
  if (node.kind === 'packageFolder') {
    return [
      { label: '展开/折叠', run: () => vscode.postMessage({ type: 'toggle', path: node.relativePath }) },
    ];
  }
  return [
    { label: '打开', run: () => cmd('vsDaw.openLibraryScore', refOf(node)) },
  ];
}

function menusFor(node) {
  if (node.kind === 'folder') return folderMenus(node);
  if (node.kind === 'package') return packageMenus(node);
  if (node.kind === 'packageFolder' || node.kind === 'packageFile') return packageEntryMenus(node);
  return scoreMenus(node);
}

function blankMenus() {
  return [
    { label: '新建目录', run: () => cmd('vsDaw.createLibraryFolder') },
    { label: '新建工程', run: () => cmd('vsDaw.newScoreInFolder') },
  ];
}

function focusInput(input) {
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

function bindInlineInput(input) {
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (committing) return;
      committing = true;
      vscode.postMessage({ type: 'inlineCommit', value: input.value });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      vscode.postMessage({ type: 'inlineCancel' });
    }
  };
  input.onblur = () => {
    if (committing) return;
    const value = input.value.trim();
    if (!value) {
      vscode.postMessage({ type: 'inlineCancel' });
      return;
    }
    committing = true;
    vscode.postMessage({ type: 'inlineCommit', value: input.value });
  };
  input.onclick = (e) => e.stopPropagation();
  input.onmousedown = (e) => e.stopPropagation();
  input.oncontextmenu = (e) => e.stopPropagation();
}

function renderEditRow(depth, kind, seed) {
  const row = document.createElement('div');
  row.className = 'row editing';
  row.style.paddingLeft = rowPad(depth) + 'px';
  const twist = document.createElement('span');
  twist.className = 'twist empty';
  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.appendChild(codicon(kind === 'folder' ? 'folder' : 'music', kind === 'folder' ? 'icon-folder' : 'icon-music'));
  const input = document.createElement('input');
  input.className = 'inline-input';
  input.type = 'text';
  input.value = seed || '';
  input.spellcheck = false;
  bindInlineInput(input);
  row.appendChild(twist);
  row.appendChild(icon);
  row.appendChild(input);
  focusInput(input);
  return row;
}

function renderNode(node, depth) {
  const frag = document.createDocumentFragment();
  const renaming = draft && draft.mode === 'rename' && draft.path === node.relativePath;
  const expandable = isExpandable(node);

  if (renaming) {
    frag.appendChild(renderEditRow(depth, node.kind === 'package' ? 'score' : node.kind, draft.seed || ''));
  } else {
    const row = document.createElement('div');
    row.className = 'row';
    row.style.paddingLeft = rowPad(depth) + 'px';
    row.draggable = node.kind === 'folder' || node.kind === 'score' || node.kind === 'package';
    row.dataset.path = node.relativePath;
    row.dataset.kind = node.kind;
    row.title = node.kind === 'package'
      ? node.name + '（DAW 包，请展开后打开 index.daw）'
      : node.name;

    const twist = document.createElement('span');
    twist.className = 'twist' + (expandable ? '' : ' empty');
    if (expandable) {
      const open = expanded.has(node.relativePath);
      twist.appendChild(codicon(open ? 'chevron-down' : 'chevron-right'));
      twist.onclick = (e) => {
        e.stopPropagation();
        vscode.postMessage({ type: 'toggle', path: node.relativePath });
      };
    }

    const icon = document.createElement('span');
    icon.className = 'icon';
    const open = expanded.has(node.relativePath);
    if (node.kind === 'folder' || node.kind === 'packageFolder') {
      icon.appendChild(codicon(open ? 'folder-opened' : 'folder', 'icon-folder'));
    } else if (node.kind === 'package') {
      icon.appendChild(codicon(open ? 'file-zip' : 'file-zip', 'icon-music'));
    } else if (node.kind === 'packageFile') {
      const isDaw = (node.entryPath || '').toLowerCase().endsWith('.daw');
      icon.appendChild(codicon(isDaw ? 'music' : 'file', 'icon-music'));
    } else {
      icon.appendChild(codicon('music', 'icon-music'));
    }

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = node.name;
    label.title = row.title;
    if (node.playing) {
      const desc = document.createElement('span');
      desc.className = 'desc';
      desc.textContent = '播放中';
      label.appendChild(desc);
    } else if (node.kind === 'package') {
      const desc = document.createElement('span');
      desc.className = 'desc';
      desc.textContent = '包';
      label.appendChild(desc);
    }

    row.appendChild(twist);
    row.appendChild(icon);
    row.appendChild(label);
    if (node.relativePath === selectedPath) row.classList.add('selected');

    if (node.kind === 'score' || node.kind === 'package') {
      const playing = node.playState === 'vsDaw.scorePlaying';
      const play = document.createElement('button');
      play.className = 'play' + (playing ? ' on' : '');
      play.type = 'button';
      play.title = playing ? '暂停' : '播放';
      play.appendChild(codicon(playing ? 'debug-pause' : 'play'));
      play.onclick = (e) => {
        e.stopPropagation();
        if (playing) cmd('vsDaw.pauseLibraryScore', refOf(node));
        else cmd('vsDaw.playLibraryScore', refOf(node));
      };
      row.appendChild(play);
    }

    row.onclick = (e) => {
      e.stopPropagation();
      selectRow(node.relativePath, node.kind);
      if (expandable) {
        vscode.postMessage({ type: 'toggle', path: node.relativePath });
      }
    };
    row.ondblclick = () => {
      selectRow(node.relativePath, node.kind);
      if (isOpenable(node)) cmd('vsDaw.openLibraryScore', refOf(node));
    };
    row.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      showMenu(e.clientX, e.clientY, menusFor(node));
    };
    row.ondragstart = (e) => {
      if (!(node.kind === 'folder' || node.kind === 'score' || node.kind === 'package')) {
        e.preventDefault();
        return;
      }
      dragPaths = [node.relativePath];
      e.dataTransfer.setData('text/plain', node.relativePath);
      e.dataTransfer.effectAllowed = 'move';
    };
    row.ondragover = (e) => {
      if (node.kind !== 'folder' && node.kind !== 'score' && node.kind !== 'package') return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('drop-target');
    };
    row.ondragleave = () => row.classList.remove('drop-target');
    row.ondrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove('drop-target');
      const destFolder = node.kind === 'folder'
        ? node.relativePath
        : (node.relativePath.includes('/') ? node.relativePath.slice(0, node.relativePath.lastIndexOf('/')) : '');
      const sources = dragPaths.length
        ? dragPaths
        : [e.dataTransfer.getData('text/plain')].filter(Boolean);
      if (sources.length) cmd('vsDaw.moveLibraryItems', { sources, destFolder });
      dragPaths = [];
    };
    frag.appendChild(row);
  }

  if (expandable && expanded.has(node.relativePath)) {
    const childDepth = depth + 1;
    const creatingHere = draft
      && (draft.mode === 'create-folder' || draft.mode === 'create-score')
      && draft.parent === node.relativePath;
    if (creatingHere) {
      frag.appendChild(renderEditRow(childDepth, draft.kind, draft.seed || ''));
    }
    for (const child of node.children || []) frag.appendChild(renderNode(child, childDepth));
  }
  return frag;
}

function indexNodes(nodes) {
  for (const node of nodes || []) {
    nodeByPath.set(node.relativePath, node);
    if (node.children) indexNodes(node.children);
  }
}

function render() {
  hideMenu();
  committing = false;
  nodeByPath = new Map();
  indexNodes(tree);
  rootEl.innerHTML = '';
  const creatingRoot = draft
    && (draft.mode === 'create-folder' || draft.mode === 'create-score')
    && !draft.parent;

  if (!tree.length && !creatingRoot) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = '谱库为空。右键可新建目录或工程。';
    rootEl.appendChild(hint);
    return;
  }

  if (creatingRoot) {
    rootEl.appendChild(renderEditRow(0, draft.kind, draft.seed || ''));
  }
  for (const node of tree) rootEl.appendChild(renderNode(node, 0));
  if (selectedPath) selectRow(selectedPath, selectedKind);
}

function renameSelected() {
  if (draft) return;
  const node = nodeByPath.get(selectedPath);
  if (!node) return;
  cmd('vsDaw.renameLibraryItem', refOf(node));
}

function activateSelected() {
  if (draft) return;
  const node = nodeByPath.get(selectedPath);
  if (!node) return;
  if (isExpandable(node)) {
    vscode.postMessage({ type: 'toggle', path: node.relativePath });
    return;
  }
  if (isOpenable(node)) cmd('vsDaw.openLibraryScore', refOf(node));
}

rootEl.oncontextmenu = (e) => {
  if (e.target !== rootEl && e.target.closest('.row')) return;
  e.preventDefault();
  showMenu(e.clientX, e.clientY, blankMenus());
};
rootEl.ondragover = (e) => {
  if (e.target === rootEl || !e.target.closest('.row')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }
};
rootEl.ondrop = (e) => {
  if (e.target !== rootEl && e.target.closest('.row')) return;
  e.preventDefault();
  cmd('vsDaw.moveLibraryItems', { sources: dragPaths, destFolder: '' });
  dragPaths = [];
};

document.addEventListener('click', (e) => {
  hideMenu();
  if (!e.target.closest('.row')) selectRow('', '');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideMenu();
    return;
  }
  if (draft) return;
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.key === 'Enter') {
    e.preventDefault();
    activateSelected();
  } else if (e.key === 'F2') {
    e.preventDefault();
    renameSelected();
  }
});

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'tree') {
    tree = msg.tree || [];
    expanded = new Set(msg.expanded || []);
    draft = msg.draft || null;
    render();
  }
});

vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
