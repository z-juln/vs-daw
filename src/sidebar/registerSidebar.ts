import * as path from "path";
import * as vscode from "vscode";
import { convertTextDawToPackage, isDawPackageFile } from "../dawPackage";
import {
  assertLibraryMove,
  createLibraryFolder,
  createLibraryScore,
  deleteLibraryFolder,
  deleteLibraryScore,
  isLibraryFolderEmpty,
  listAllFolders,
  renameLibraryEntry,
  sanitizeFolderPath,
  sanitizeFolderSegment,
  sanitizeScoreName,
} from "../library";
import { ensurePackageEntry } from "../packageCache";
import { emptyTemplate } from "../serialize";
import { GRID_VIEW_TYPE } from "../gridEditor/DawGridEditorProvider";
import { CreatorProvider } from "./creatorProvider";
import {
  asPlaylistRef,
  dropTargetFolder,
  PlaylistProvider,
  PlaylistRef,
  PlaylistViewState,
} from "./playlistProvider";
import { LearnHudProvider, LearnHudState } from "./learnHudProvider";
import { RecorderProvider, RecorderViewState } from "./recorderProvider";

export interface SidebarController {
  refreshPlaylist(): void;
  refreshRecorder(): void;
  refreshLearnHud(): void;
  revealLearnHud(): Promise<void>;
  tickRecorder(payload: {
    playing: boolean;
    position: string;
    positionSec: number;
    durationSec: number;
    bpm: number;
  }): void;
}

export interface SidebarHost {
  getRecorderState(): RecorderViewState;
  getLearnHudState(): LearnHudState;
  getPlaylistState(): PlaylistViewState;
  playScoreFile(absolutePath: string): Promise<void>;
  pauseScoreFile(absolutePath: string): Promise<void>;
  syncLibrary(): Promise<void>;
}

function itemPath(item: unknown): string | undefined {
  const ref = asPlaylistRef(item);
  if (ref) return ref.absolutePath;
  if (item instanceof vscode.Uri) return item.fsPath;
  return typeof item === "string" ? item : undefined;
}

function folderRelativePath(item: unknown): string {
  const ref = asPlaylistRef(item);
  if (ref) return ref.kind === "folder" ? ref.relativePath : dropTargetFolder(ref);
  if (typeof item === "string") return sanitizeFolderPath(item);
  return "";
}

const MANUALS: Record<string, { file: string; title: string }> = {
  skill: { file: "agent/SKILL.md", title: "工程格式手册" },
  readme: { file: "README.md", title: "使用说明" },
};

export function registerSidebar(
  context: vscode.ExtensionContext,
  root: string,
  host: SidebarHost,
): SidebarController {
  const playlist = new PlaylistProvider(root, () => host.getPlaylistState(), context.extensionUri);
  const recorder = new RecorderProvider(() => host.getRecorderState());
  const learnHud = new LearnHudProvider(() => host.getLearnHudState());
  const creator = new CreatorProvider();

  const register = (command: string, handler: (...args: any[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(command, handler));
  };

  const openScore = async (value: unknown): Promise<void> => {
    const ref = asPlaylistRef(value);
    if (ref?.kind === "package") {
      void vscode.window.showInformationMessage(
        "DAW 包不能直接打开，请展开后打开内部的 index.daw 或其它文件。",
      );
      return;
    }
    if (ref?.kind === "packageFolder") {
      return;
    }
    if (ref?.kind === "packageFile" && ref.packagePath && ref.entryPath) {
      try {
        const materialized = await ensurePackageEntry(ref.packagePath, ref.entryPath);
        const uri = vscode.Uri.file(materialized);
        if (ref.entryPath.toLowerCase().endsWith(".daw")) {
          await vscode.commands.executeCommand("vscode.openWith", uri, GRID_VIEW_TYPE);
        } else {
          await vscode.commands.executeCommand("vscode.open", uri);
        }
      } catch (error) {
        void vscode.window.showErrorMessage(`打开包内文件失败：${(error as Error).message}`);
      }
      return;
    }
    const target = itemPath(value);
    if (!target) return;
    if (await isDawPackageFile(target)) {
      void vscode.window.showInformationMessage(
        "DAW 包不能直接打开，请在播放列表展开后打开 index.daw。",
      );
      return;
    }
    await vscode.commands.executeCommand(
      "vscode.openWith",
      vscode.Uri.file(target),
      GRID_VIEW_TYPE,
    );
  };

  playlist.configure({
    openScore: async (absolutePath) => openScore(absolutePath),
    scoreDefaults: () => ({ bpm: creator.state.bpm, bars: creator.state.bars }),
  });

  const createScore = async (folder?: string): Promise<void> => {
    if (folder !== undefined) creator.state.folder = folder;
    const content = emptyTemplate({ bpm: creator.state.bpm, bars: creator.state.bars });
    let target: string;
    try {
      target = await createLibraryScore(root, creator.state.name, content, {
        folder: creator.state.folder,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        void vscode.window.showErrorMessage(`创建工程失败：${(error as Error).message}`);
        return;
      }
      const fileName = sanitizeScoreName(creator.state.name);
      const folderLabel = creator.state.folder || "根目录";
      const answer = await vscode.window.showWarningMessage(
        `${folderLabel}/${fileName} 已存在，是否覆盖？`,
        { modal: true },
        "覆盖",
      );
      if (answer !== "覆盖") return;
      target = await createLibraryScore(root, creator.state.name, content, {
        folder: creator.state.folder,
        overwrite: true,
      });
    }
    playlist.refresh();
    await openScore(target);
  };

  const pickLibraryFolder = async (title: string, current = ""): Promise<string | undefined> => {
    const folders = await listAllFolders(root);
    const items = [
      { label: "根目录", description: "谱库顶层", folder: "" },
      ...folders.map((folder) => ({ label: folder, description: "目录", folder })),
      { label: "$(new-folder) 新建目录…", description: "输入新的相对路径", folder: "__new__" },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title,
      placeHolder: current ? `当前：${current || "根目录"}` : "选择目录",
    });
    if (!picked) return undefined;
    if (picked.folder === "__new__") {
      const value = await vscode.window.showInputBox({
        title: "新建目录（可嵌套，如 loops/styles/rock）",
        validateInput: (input) => {
          try {
            sanitizeFolderPath(input);
            return undefined;
          } catch (error) {
            return (error as Error).message;
          }
        },
      });
      if (value === undefined) return undefined;
      const safePath = sanitizeFolderPath(value);
      try {
        await createLibraryFolder(root, safePath);
        playlist.refresh();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          void vscode.window.showErrorMessage(`创建目录失败：${(error as Error).message}`);
          return undefined;
        }
      }
      return safePath;
    }
    return picked.folder;
  };

  register("vsDaw.openManual", async (which: string = "skill") => {
    const manual = MANUALS[which] ?? MANUALS.skill;
    const uri = vscode.Uri.joinPath(context.extensionUri, ...manual.file.split("/"));
    try {
      await vscode.commands.executeCommand("markdown.showPreview", uri);
    } catch {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
    }
  });
  register("vsDaw.syncLibrary", async () => {
    try {
      await host.syncLibrary();
      playlist.refresh();
    } catch (error) {
      void vscode.window.showErrorMessage(`同步示例失败：${(error as Error).message}`);
    }
  });
  register("vsDaw.refreshLibrary", () => playlist.refresh());
  register("vsDaw.collapsePlaylist", () => playlist.collapseAll());
  register("vsDaw.openLibraryScore", openScore);
  register("vsDaw.playLibraryScore", async (item: unknown) => {
    const target = itemPath(item);
    if (!target) return;
    try {
      await host.playScoreFile(target);
    } catch (error) {
      void vscode.window.showErrorMessage(`播放失败：${(error as Error).message}`);
    }
  });
  register("vsDaw.pauseLibraryScore", async (item: unknown) => {
    const target = itemPath(item);
    if (!target) return;
    try {
      await host.pauseScoreFile(target);
    } catch (error) {
      void vscode.window.showErrorMessage(`暂停失败：${(error as Error).message}`);
    }
  });
  register("vsDaw.deleteLibraryScore", async (item: unknown) => {
    const target = itemPath(item);
    if (!target) return;
    const answer = await vscode.window.showWarningMessage(
      `确定删除 ${path.basename(target)}？此操作不可撤销。`,
      { modal: true },
      "删除",
    );
    if (answer !== "删除") return;
    try {
      await deleteLibraryScore(root, target);
      playlist.refresh();
    } catch (error) {
      void vscode.window.showErrorMessage(`删除失败：${(error as Error).message}`);
    }
  });
  register("vsDaw.convertToPackage", async (item: unknown) => {
    const target = itemPath(item);
    if (!target) return;
    if (await isDawPackageFile(target)) {
      void vscode.window.showInformationMessage("已经是 DAW 包，可展开后编辑 index.daw / assets。");
      return;
    }
    const name = path.basename(target);
    const answer = await vscode.window.showWarningMessage(
      `将「${name}」转为采样包？\n原文本会写入包内 index.daw，并创建 assets/ 目录（同级已有 assets/ 会一并打入）。此操作会替换该文件。`,
      { modal: true },
      "转为采样包",
    );
    if (answer !== "转为采样包") return;
    try {
      const { copiedAssets } = await convertTextDawToPackage(target);
      playlist.refresh();
      void vscode.window.showInformationMessage(
        copiedAssets > 0
          ? `已转为 DAW 包，并打入 ${copiedAssets} 个 assets 文件。展开后可打开 index.daw。`
          : "已转为 DAW 包。展开后可打开 index.daw，并把采样放进 assets/。",
      );
    } catch (error) {
      void vscode.window.showErrorMessage(`转换失败：${(error as Error).message}`);
    }
  });
  register("vsDaw.createLibraryFolder", (item?: unknown) => {
    playlist.beginCreateFolder(folderRelativePath(item));
  });
  const renamePlaylistItem = (item?: unknown): void => {
    const ref = asPlaylistRef(item);
    if (!ref) return;
    playlist.beginRename(ref);
  };
  register("vsDaw.renameLibraryFolder", renamePlaylistItem);
  register("vsDaw.renameLibraryItem", renamePlaylistItem);
  register("vsDaw.deleteLibraryFolder", async (item?: unknown) => {
    const ref = asPlaylistRef(item);
    if (!ref || ref.kind !== "folder") return;
    const empty = await isLibraryFolderEmpty(root, ref.relativePath);
    const answer = await vscode.window.showWarningMessage(
      empty
        ? `确定删除空目录 ${ref.relativePath}？`
        : `确定删除目录 ${ref.relativePath} 及其中的全部工程？此操作不可撤销。`,
      { modal: true },
      "删除",
    );
    if (answer !== "删除") return;
    try {
      await deleteLibraryFolder(root, ref.relativePath);
      playlist.refresh();
    } catch (error) {
      void vscode.window.showErrorMessage(`删除目录失败：${(error as Error).message}`);
    }
  });
  register("vsDaw.newScoreInFolder", (item?: unknown) => {
    const folder = folderRelativePath(item);
    creator.state.folder = folder;
    creator.refresh();
    playlist.beginCreateScore(folder);
  });
  register("vsDaw.moveLibraryItems", async (payload?: {
    sources?: string[];
    destFolder?: string;
  }) => {
    const sources = payload?.sources ?? [];
    const destFolder = sanitizeFolderPath(payload?.destFolder ?? "");
    if (!sources.length) return;
    let moved = 0;
    for (const fromRel of sources) {
      const baseName = fromRel.split("/").pop();
      if (!baseName) continue;
      const toRel = destFolder ? `${destFolder}/${baseName}` : baseName;
      if (fromRel === toRel) continue;
      try {
        if (destFolder === fromRel || destFolder.startsWith(`${fromRel}/`)) {
          throw new Error("不能移动到自身或子目录");
        }
        assertLibraryMove(root, fromRel, toRel);
        await renameLibraryEntry(root, fromRel, toRel);
        moved += 1;
      } catch (error) {
        void vscode.window.showErrorMessage(
          `移动 ${baseName} 失败：${(error as Error).message}`,
        );
      }
    }
    if (moved > 0) playlist.refresh();
  });
  register("vsDaw.creatorSetName", async () => {
    const value = await vscode.window.showInputBox({
      title: "工程名称",
      value: creator.state.name,
      validateInput: (input) => {
        try {
          sanitizeScoreName(input);
          return undefined;
        } catch (error) {
          return (error as Error).message;
        }
      },
    });
    if (value !== undefined) {
      creator.state.name = value.trim();
      creator.refresh();
    }
  });
  register("vsDaw.creatorSetFolder", async () => {
    const picked = await pickLibraryFolder("创建到哪个目录", creator.state.folder);
    if (picked === undefined) return;
    creator.state.folder = picked;
    creator.refresh();
  });
  register("vsDaw.creatorSetBpm", async () => {
    const value = await vscode.window.showInputBox({
      title: "BPM（20–400）",
      value: String(creator.state.bpm),
      validateInput: (input) => {
        const bpm = Number(input);
        return Number.isInteger(bpm) && bpm >= 20 && bpm <= 400
          ? undefined
          : "请输入 20–400 的整数";
      },
    });
    if (value !== undefined) {
      creator.state.bpm = Number(value);
      creator.refresh();
    }
  });
  register("vsDaw.creatorSetBars", async () => {
    const value = await vscode.window.showInputBox({
      title: "小节数（1–128）",
      value: String(creator.state.bars),
      validateInput: (input) => {
        const bars = Number(input);
        return Number.isInteger(bars) && bars >= 1 && bars <= 128
          ? undefined
          : "请输入 1–128 的整数";
      },
    });
    if (value !== undefined) {
      creator.state.bars = Number(value);
      creator.refresh();
    }
  });
  register("vsDaw.creatorCreate", () => createScore());
  register("vsDaw.newScore", () => {
    creator.state.folder = "";
    creator.refresh();
    playlist.beginCreateScore("");
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("vsDaw.playlist", playlist, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider("vsDaw.recorder", recorder, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider("vsDaw.learnHud", learnHud, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerTreeDataProvider("vsDaw.creator", creator),
  );

  return {
    refreshPlaylist: () => playlist.refresh(),
    refreshRecorder: () => recorder.refresh(),
    refreshLearnHud: () => learnHud.refresh(),
    revealLearnHud: () => learnHud.reveal(),
    tickRecorder: (payload) => recorder.tick(payload),
  };
}

// 供测试 / 类型再导出
export type { PlaylistRef };
