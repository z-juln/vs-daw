import { promises as fs } from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { getKeyMap, getLoop, getPadModeOnOpen, isDrumEditor } from "./config";
import {
  isDawPackageFile,
  normalizeSamplePath,
  readPackageAsset,
  readPackageIndex,
} from "./dawPackage";
import { DawEngine } from "./engine";
import {
  DEFAULT_CHANNEL,
  DEFAULT_OCTAVE,
  DEFAULT_PROGRAM,
  DRUM_TO_GM,
  isPitchRole,
  ROLE_LABEL_ZH,
  TRACK_ROLES,
} from "./midi/gm";
import { encodeMidi } from "./midi/encode";
import { decodeMidiToSession } from "./midi/decode";
import { createNativeContext } from "./nativeContext";
import { defaultLibraryRoot, ensureLibrary, readLibraryScore } from "./library";
import { columnToStep } from "./mapper";
import { packageForCacheFile, repackPackage } from "./packageCache";
import { resolvePitchPad } from "./padLayout";
import { PadMode } from "./padMode";
import { parseSession } from "./parser";
import { midiToPitch } from "./pitch";
import {
  buildPlayheadIndex,
  playheadCellsFromIndex,
  playheadStep,
  PlayheadIndex,
} from "./playhead";
import { RecordingMode } from "./recordingMode";
import {
  midiNotesOnly,
  scheduleSession,
  scoreDurationSec,
  sessionHasSampleTracks,
  stepDurationSec,
} from "./schedule";
import { emptyTemplate, formatScoreText, formatSessionText, writeHit } from "./serialize";
import { registerSidebar, SidebarController } from "./sidebar/registerSidebar";
import {
  broadcastLearn,
  broadcastPlayhead,
  getActiveGridDocument,
  GRID_VIEW_TYPE,
  registerGridEditor,
  setActiveGridChangeHandler,
  setGridSeekByStepHandler,
  setLearnReadyHandler,
} from "./gridEditor/DawGridEditorProvider";
import {
  extractMelody,
  learnUiState,
  LearnFeedback,
  MelodyNote,
} from "./melodyLearn";
import {
  createTransport,
  positionAt,
  reduceTransport,
  resolveTransportAction,
  TransportEngine,
  TransportEvent,
} from "./transport";
import { Session, TrackRole } from "./types";

interface PlaybackSource {
  uri?: vscode.Uri;
  text: string;
  /** 播放 DAW 包时指向 zip 绝对路径，用于解析 assets/。 */
  packagePath?: string;
}

let engine: DawEngine | undefined;

const nowSec = (): number => Date.now() / 1000;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const sf2Path = vscode.Uri.joinPath(context.extensionUri, "media", "soundfonts", "gm.sf3").fsPath;
  const audio = new DawEngine(createNativeContext, { sf2Path });
  engine = audio;
  const padMode = new PadMode();
  const recordingMode = new RecordingMode(
    (key, value) => vscode.commands.executeCommand("setContext", key, value),
  );
  const output = vscode.window.createOutputChannel("VS DAW");
  const playhead = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
    borderWidth: "0 0 0 2px",
    borderStyle: "solid",
    borderColor: new vscode.ThemeColor("editorCursor.foreground"),
    overviewRulerColor: new vscode.ThemeColor("editorCursor.foreground"),
    overviewRulerLane: vscode.OverviewRulerLane.Center,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  let transport: TransportEngine = createTransport({ loop: getLoop() });
  let currentPosition = 0;
  let currentDuration = 0;
  let source: PlaybackSource | undefined;
  let sessionCache: Session | undefined;
  /** `${uri}:${version}` 或 loadSource 写入的标记，避免每 tick 重解析大谱面 */
  let sessionDocKey = "";
  let playheadIndex: PlayheadIndex | undefined;
  let lastPlayheadStep = -1;
  let lastContextPlaying: boolean | undefined;
  let armedTrackName = "piano";
  let learnActive = false;
  let learnNotes: MelodyNote[] = [];
  let learnIndex = 0;
  let learnFeedback: LearnFeedback = "idle";
  let learnFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
  /** 学习绑定的工程 URI：关 tab 不退出模式。 */
  let learnDocumentUri: vscode.Uri | undefined;
  let learnStepSec = 0;
  let learnFileLabel = "";
  const learnStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 5);
  learnStatus.command = "vsDaw.toggleMelodyLearn";
  context.subscriptions.push(learnStatus);
  let armedFallbackRole: TrackRole = "keys";
  /** Pad 基准八度（低排 zxcvbnm 的 C）；各 role 默认见 midi/gm.ts。 */
  let octave = DEFAULT_OCTAVE.keys;
  let sidebar: SidebarController | undefined;
  const libraryRoot = defaultLibraryRoot();

  const ROLE_PICK: { role: TrackRole; label: string; name: string }[] = TRACK_ROLES
    .filter((role) => role !== "sample")
    .map((role) => ({
      role,
      label: ROLE_LABEL_ZH[role],
      name: role === "keys" ? "piano" : role,
    }));

  const resolveSampleBytes = (next: PlaybackSource) =>
    async (samplePath: string): Promise<Uint8Array | undefined> => {
      const normalized = normalizeSamplePath(samplePath);
      if (!normalized) return undefined;
      const tryRead = async (filePath: string): Promise<Uint8Array | undefined> => {
        try {
          return await fs.readFile(filePath);
        } catch {
          return undefined;
        }
      };
      if (next.packagePath) {
        try {
          return await readPackageAsset(next.packagePath, normalized);
        } catch {
          return undefined;
        }
      }
      if (next.uri?.scheme === "file") {
        const pkg = packageForCacheFile(next.uri.fsPath);
        if (pkg) {
          try {
            return await readPackageAsset(pkg, normalized);
          } catch {
            return undefined;
          }
        }
        return tryRead(path.join(path.dirname(next.uri.fsPath), ...normalized.split("/")));
      }
      return undefined;
    };

  const applyRoleOctave = (role: TrackRole): void => {
    if (role === "drums") return;
    octave = DEFAULT_OCTAVE[role];
  };

  /** Pad 开启时默认落到钢琴轨（有 keys 轨则选它，否则试听用 piano/keys）。 */
  const armPianoForPad = (): void => {
    const session = currentSession();
    const piano = session?.tracks.find((track) => track.role === "keys");
    if (piano) {
      armedTrackName = piano.name;
      armedFallbackRole = "keys";
    } else {
      armedTrackName = "piano";
      armedFallbackRole = "keys";
    }
    applyRoleOctave("keys");
  };

  const bundledExamplesDir = vscode.Uri.joinPath(context.extensionUri, "examples").fsPath;
  try {
    const copied = await ensureLibrary(libraryRoot, bundledExamplesDir);
    if (copied.length > 0) output.appendLine(`已同步 ${copied.length} 首示例`);
  } catch (error) {
    void vscode.window.showErrorMessage(`初始化谱库失败：${(error as Error).message}`);
  }

  const activeDawEditor = (): vscode.TextEditor | undefined => {
    const editor = vscode.window.activeTextEditor;
    return isDrumEditor(editor) ? editor : undefined;
  };

  const activeDawDocument = (): vscode.TextDocument | undefined => {
    const editor = activeDawEditor();
    if (editor) return editor.document;
    const grid = getActiveGridDocument();
    if (!grid) return undefined;
    if (grid.languageId === "vs-daw") return grid;
    return path.extname(grid.fileName).toLowerCase() === ".daw" ? grid : undefined;
  };

  const currentSource = (): PlaybackSource | undefined => {
    const document = activeDawDocument();
    if (document) return { uri: document.uri, text: document.getText() };
    return source;
  };

  const rebuildPlayheadIndex = (
    session: Session,
    getLineText: (lineIndex: number) => string | undefined,
  ): void => {
    playheadIndex = buildPlayheadIndex(session, getLineText);
    lastPlayheadStep = -1;
  };

  const rememberSession = (
    session: Session,
    docKey: string,
    getLineText?: (lineIndex: number) => string | undefined,
  ): Session => {
    sessionCache = session;
    sessionDocKey = docKey;
    if (getLineText) rebuildPlayheadIndex(session, getLineText);
    else lastPlayheadStep = -1;
    if (!session.tracks.some((track) => track.name === armedTrackName)) {
      armedTrackName = session.tracks[0]?.name ?? "drums";
      armedFallbackRole = session.tracks[0]?.role ?? "drums";
    } else {
      armedFallbackRole = session.tracks.find((track) => track.name === armedTrackName)?.role
        ?? armedFallbackRole;
    }
    return session;
  };

  const currentSession = (): Session | undefined => {
    const document = activeDawDocument();
    if (document) {
      const key = `${document.uri.toString()}:${document.version}`;
      if (sessionCache && sessionDocKey === key) return sessionCache;
      const text = document.getText();
      const lines = text.split(/\r?\n/);
      return rememberSession(
        parseSession(text),
        key,
        (lineIndex) => lines[lineIndex],
      );
    }
    return sessionCache;
  };

  const armedTrack = () => currentSession()?.tracks.find((track) => track.name === armedTrackName);

  const armedRole = (): TrackRole => armedTrack()?.role ?? armedFallbackRole;

  const positionLabel = (): { bpm: number; label: string } => {
    const session = sessionCache ?? currentSession();
    if (!session) return { bpm: 120, label: "1.1" };
    const step = Math.floor(currentPosition / stepDurationSec(session));
    const bar = Math.floor(step / session.stepsPerBar) + 1;
    const beat = Math.floor((step % session.stepsPerBar) / (session.stepsPerBar / 4)) + 1;
    return { bpm: session.bpm, label: `${bar}.${beat}` };
  };

  const transportOwnsActiveDoc = (): boolean => {
    const document = activeDawDocument();
    if (!document?.uri || !source?.uri) return true;
    return document.uri.toString() === source.uri.toString();
  };

  const setPlayingContext = (): void => {
    // 正在播 A、焦点在 B 时标题栏应显示「播放」（切到 B），而不是「暂停」
    const playing = transport.status === "playing" && transportOwnsActiveDoc();
    if (lastContextPlaying === playing) return;
    lastContextPlaying = playing;
    void vscode.commands.executeCommand("setContext", "vsDaw.playing", playing);
  };

  const updateEditorChrome = (): void => {
    setPlayingContext();
  };

  const ensureDawLanguage = (document: vscode.TextDocument): void => {
    const ext = path.extname(document.fileName).toLowerCase();
    if (ext === ".daw" && document.languageId !== "vs-daw") {
      void vscode.languages.setTextDocumentLanguage(document, "vs-daw");
    }
  };

  const visibleLineSpan = (
    editor: vscode.TextEditor,
  ): { startLine: number; endLine: number } | undefined => {
    if (editor.visibleRanges.length === 0) return undefined;
    let startLine = editor.visibleRanges[0].start.line;
    let endLine = editor.visibleRanges[0].end.line;
    for (const range of editor.visibleRanges) {
      startLine = Math.min(startLine, range.start.line);
      endLine = Math.max(endLine, range.end.line);
    }
    // 略扩一点，减少滚轮边缘闪烁
    return {
      startLine: Math.max(0, startLine - 2),
      endLine: Math.min(editor.document.lineCount - 1, endLine + 2),
    };
  };

  const indexForEditor = (editor: vscode.TextEditor, isSource: boolean): PlayheadIndex | undefined => {
    const key = `${editor.document.uri.toString()}:${editor.document.version}`;
    if (playheadIndex && sessionDocKey === key) return playheadIndex;
    if (isSource && sessionCache && playheadIndex) {
      // 播放源已有索引：仅在文档版本变化时按当前文本重建列缓存，不重解析 Session
      const lines = editor.document.getText().split(/\r?\n/);
      rebuildPlayheadIndex(sessionCache, (lineIndex) => lines[lineIndex]);
      sessionDocKey = key;
      return playheadIndex;
    }
    if (isSource && sessionCache) {
      const lines = editor.document.getText().split(/\r?\n/);
      rememberSession(sessionCache, key, (lineIndex) => lines[lineIndex]);
      return playheadIndex;
    }
    const text = editor.document.getText();
    const lines = text.split(/\r?\n/);
    rememberSession(parseSession(text), key, (lineIndex) => lines[lineIndex]);
    return playheadIndex;
  };

  const updatePlayhead = (force = false): void => {
    const sourceKey = source?.uri?.toString();
    let stepped: number | undefined;
    if (playheadIndex && !force) {
      const step = playheadStep(playheadIndex, currentPosition);
      if (step === lastPlayheadStep) return;
      lastPlayheadStep = step;
      stepped = step;
    }
    for (const editor of vscode.window.visibleTextEditors) {
      if (!isDrumEditor(editor)) continue;
      const uriKey = editor.document.uri.toString();
      const isSource = Boolean(sourceKey && sourceKey === uriKey);
      const isActive = vscode.window.activeTextEditor === editor;
      if (!isSource && !isActive) {
        editor.setDecorations(playhead, []);
        continue;
      }
      const index = indexForEditor(editor, isSource);
      if (!index) continue;
      const positionSec = isSource ? currentPosition : 0;
      if (force) lastPlayheadStep = playheadStep(index, positionSec);
      // 不 revealRange：API 无法只滚 X，跟播会连带改 Y，打断纵向浏览
      const ranges = playheadCellsFromIndex(index, positionSec, visibleLineSpan(editor)).map((cell) => {
        const lineLen = editor.document.lineAt(cell.line).text.length;
        const start = Math.min(Math.max(0, cell.character), Math.max(0, lineLen - 1));
        const end = Math.min(start + 1, lineLen);
        return new vscode.Range(cell.line, start, cell.line, end);
      });
      editor.setDecorations(playhead, ranges);
    }
    if (playheadIndex && source?.uri) {
      broadcastPlayhead(
        source.uri,
        stepped ?? playheadStep(playheadIndex, currentPosition),
      );
    }
  };

  const updateStatus = (): void => {
    updateEditorChrome();
    updatePlayhead(true);
    sidebar?.refreshRecorder();
    sidebar?.refreshPlaylist();
  };

  let audioBroken = false;
  const withAudio = (action: () => void): void => {
    if (audioBroken) return;
    try {
      action();
    } catch (error) {
      audioBroken = true;
      void vscode.window.showErrorMessage(`音频引擎失败：${(error as Error).message}`);
    }
  };

  audio.onTick = (positionSec) => {
    currentPosition = positionSec;
    updatePlayhead(false);
    const { bpm, label } = positionLabel();
    sidebar?.tickRecorder({
      playing: true,
      position: label,
      positionSec,
      durationSec: currentDuration,
      bpm,
    });
  };

  const replaceDocument = async (
    editor: vscode.TextEditor,
    text: string,
  ): Promise<boolean> => editor.edit((builder) => {
    const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
    builder.replace(
      new vscode.Range(0, 0, lastLine.lineNumber, lastLine.text.length),
      text,
    );
  });

  const replaceDocumentText = async (
    document: vscode.TextDocument,
    text: string,
  ): Promise<boolean> => {
    const edit = new vscode.WorkspaceEdit();
    const full = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length),
    );
    edit.replace(document.uri, full, text);
    return vscode.workspace.applyEdit(edit);
  };

  const loadSource = async (next: PlaybackSource): Promise<boolean> => {
    const session = parseSession(next.text);
    session.warnings.forEach((warning) => {
      const prefix = warning.line === undefined ? "" : `第 ${warning.line + 1} 行：`;
      output.appendLine(`${prefix}${warning.message}`);
    });
    if (session.unsupportedVersion) {
      void vscode.window.showErrorMessage("此工程版本暂不支持");
      return false;
    }
    source = next;
    const editor = vscode.window.visibleTextEditors.find(
      (item) => next.uri && item.document.uri.toString() === next.uri.toString(),
    );
    const lines = next.text.split(/\r?\n/);
    const docKey = editor
      ? `${editor.document.uri.toString()}:${editor.document.version}`
      : next.uri
        ? `${next.uri.toString()}:loaded`
        : "memory:loaded";
    rememberSession(session, docKey, (lineIndex) => lines[lineIndex]);
    currentDuration = scoreDurationSec(session);
    transport = { ...transport, loop: getLoop() };
    const notes = scheduleSession(session);
    try {
      await audio.loadSession(
        session,
        notes,
        currentDuration,
        transport.loop,
        resolveSampleBytes(next),
      );
    } catch (error) {
      void vscode.window.showErrorMessage(`加载音频失败：${(error as Error).message}`);
      return false;
    }
    return true;
  };

  const sameLoadedSource = (next: PlaybackSource): boolean => {
    if (!source || !audio.hasBuffer) return false;
    if (source.uri && next.uri) {
      return source.uri.toString() === next.uri.toString() && source.text === next.text;
    }
    if (source.uri || next.uri) return false;
    return source.text === next.text;
  };

  const pushTransportChrome = (): void => {
    // 状态栏 + 标题栏 context，即时切换播放/暂停
    updateEditorChrome();
    const { bpm, label } = positionLabel();
    sidebar?.tickRecorder({
      playing: transport.status === "playing" && transportOwnsActiveDoc(),
      position: label,
      positionSec: currentPosition,
      durationSec: currentDuration,
      bpm,
    });
  };

  const applyTransport = async (
    event: TransportEvent,
    explicit?: PlaybackSource,
  ): Promise<void> => {
    let next = explicit ?? currentSource();
    const resolvedType = resolveTransportAction(
      transport.status,
      event.type,
      source?.uri?.toString(),
      next?.uri?.toString(),
    );

    if (resolvedType === "pause" || resolvedType === "stop") {
      if (!source) return;
      const time = nowSec();
      transport = reduceTransport(transport, { type: resolvedType }, time);
      currentPosition = resolvedType === "stop"
        ? 0
        : positionAt(transport, time, currentDuration);
      // 先改按钮，再停音频
      pushTransportChrome();
      withAudio(() => (resolvedType === "stop" ? audio.stop() : audio.pause()));
      setTimeout(() => {
        updatePlayhead(true);
        sidebar?.refreshRecorder();
        sidebar?.refreshPlaylist();
      }, 0);
      return;
    }

    if (!next) {
      void vscode.window.showWarningMessage("请先打开 .daw，或在播放列表中选择");
      return;
    }
    const editor = activeDawEditor();
    const document = activeDawDocument();
    if (!explicit && document && next.text.trim() === "") {
      if (editor) await replaceDocument(editor, emptyTemplate());
      else await replaceDocumentText(document, emptyTemplate());
      next = { uri: document.uri, text: (activeDawDocument() ?? document).getText() };
    }

    const switchingFile = Boolean(
      source?.uri
      && next.uri
      && source.uri.toString() !== next.uri.toString(),
    );

    // 暂停/停止后同曲未改内容：跳过 SoundFont 整曲重渲染，直接续播
    const canResume = !switchingFile && resolvedType !== "restart" && sameLoadedSource(next);
    if (!canResume) {
      const loaded = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: "VS DAW: 加载中…" },
        () => loadSource(next),
      );
      if (!loaded) return;
      if (switchingFile || resolvedType === "restart") {
        currentPosition = 0;
        transport = {
          ...transport,
          loop: getLoop(),
          anchorScoreSec: 0,
          anchorWallSec: nowSec(),
        };
      }
    } else {
      source = next;
      transport = { ...transport, loop: getLoop() };
    }

    const time = nowSec();
    transport = reduceTransport(
      transport,
      { type: resolvedType === "restart" ? "restart" : "play" },
      time,
    );
    currentPosition = positionAt(transport, time, currentDuration);
    // 先改按钮，再起音频
    pushTransportChrome();
    if (transport.status === "playing") {
      withAudio(() => audio.play(currentPosition));
    }
    setTimeout(() => {
      updatePlayhead(true);
      sidebar?.refreshRecorder();
      sidebar?.refreshPlaylist();
    }, 0);
  };

  const register = (command: string, handler: (...args: any[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(command, handler));
  };

  const resolvePadNote = (key: string): {
    note: number;
    velocity: number;
    channel: number;
    program: number;
    rowId: string;
    role: TrackRole;
  } | undefined => {
    const track = armedTrack();
    const role = track?.role ?? armedFallbackRole;
    const channel = track?.channel ?? DEFAULT_CHANNEL[role];
    const program = track?.program ?? DEFAULT_PROGRAM[role];
    if (role === "drums") {
      const drumId = getKeyMap()[key];
      if (!drumId) return undefined;
      const note = DRUM_TO_GM[drumId];
      if (note === undefined) return undefined;
      return { note, velocity: 100, channel, program, rowId: drumId, role };
    }
    const pitch = resolvePitchPad(key, octave, { numberRow: role === "keys" });
    if (!pitch) return undefined;
    return {
      note: pitch.midi,
      velocity: 100,
      channel,
      program,
      rowId: midiToPitch(pitch.midi),
      role,
    };
  };

  register("vsDaw.enablePadMode", async () => {
    if (padMode.enabled) return;
    armPianoForPad();
    await padMode.set(true);
    withAudio(() => audio.warmUp());
    updateStatus();
  });
  register("vsDaw.togglePadMode", async () => {
    const next = !padMode.enabled;
    if (next) armPianoForPad();
    await padMode.set(next);
    if (padMode.enabled) withAudio(() => audio.warmUp());
    updateStatus();
  });
  register("vsDaw.exitPadMode", async () => {
    if (!padMode.enabled) return;
    await padMode.set(false);
    await applyTransport({ type: "stop" });
    updateStatus();
  });
  register("vsDaw.toggleRecording", async () => {
    await recordingMode.toggle();
    updateStatus();
  });
  register("vsDaw.warmUpAudio", () => {
    audioBroken = false;
    withAudio(() => audio.warmUp());
    updateStatus();
  });
  register("vsDaw.formatScore", async () => {
    const editor = activeDawEditor();
    if (editor) {
      await replaceDocument(editor, formatScoreText(editor.document.getText()));
      return;
    }
    const document = activeDawDocument();
    if (document) await replaceDocumentText(document, formatScoreText(document.getText()));
  });
  register("vsDaw.playPause", () => applyTransport({ type: "playPause" }));
  register("vsDaw.editorPlay", () => applyTransport({ type: "play" }));
  register("vsDaw.editorPause", () => applyTransport({ type: "pause" }));
  register("vsDaw.restart", () => applyTransport({ type: "restart" }));
  register("vsDaw.stop", () => applyTransport({ type: "stop" }));
  register("vsDaw.cloneScore", async () => {
    const document = activeDawDocument();
    if (!document) {
      void vscode.window.showWarningMessage("请先打开 .daw 工程");
      return;
    }
    const text = document.getText();
    const original = document.uri;
    let target: vscode.Uri;
    if (original.scheme !== "file") {
      const picked = await vscode.window.showSaveDialog({
        filters: { DAW: ["daw"] },
        defaultUri: vscode.Uri.file(path.join(libraryRoot, "untitled-copy.daw")),
        saveLabel: "克隆为",
      });
      if (!picked) return;
      target = picked;
    } else {
      const dir = path.dirname(original.fsPath);
      const ext = path.extname(original.fsPath) || ".daw";
      const base = path.basename(original.fsPath, ext);
      const candidates = [
        `${base}-copy${ext}`,
        ...Array.from({ length: 48 }, (_, index) => `${base}-copy-${index + 2}${ext}`),
      ];
      let resolved: string | undefined;
      for (const name of candidates) {
        const full = path.join(dir, name);
        try {
          await vscode.workspace.fs.stat(vscode.Uri.file(full));
        } catch {
          resolved = full;
          break;
        }
      }
      target = vscode.Uri.file(resolved ?? path.join(dir, `${base}-copy-${Date.now()}${ext}`));
    }
    await vscode.workspace.fs.writeFile(target, Buffer.from(text, "utf8"));
    sidebar?.refreshPlaylist();
    await vscode.commands.executeCommand("vscode.openWith", target, GRID_VIEW_TYPE);
    void vscode.window.showInformationMessage(`已克隆为 ${path.basename(target.fsPath)}`);
  });
  const learnUri = (): vscode.Uri | undefined =>
    learnDocumentUri ?? getActiveGridDocument()?.uri ?? activeDawDocument()?.uri;

  const syncLearnChrome = (): void => {
    void vscode.commands.executeCommand("setContext", "vsDaw.learnActive", learnActive);
    if (!learnActive) {
      learnStatus.hide();
      return;
    }
    const ui = learnUiState(learnNotes, learnIndex, learnFeedback);
    const done = ui.feedback === "done" || ui.total === 0;
    const progress = done
      ? `${ui.total}/${ui.total}`
      : `${Math.min(ui.index + 1, ui.total)}/${ui.total}`;
    const pitch = done ? "完成" : (ui.pitch || "—");
    learnStatus.text = `$(circle-outline) ${pitch}  ${progress}`;
    learnStatus.tooltip = learnFileLabel
      ? `跟练 ${learnFileLabel}（点击关闭）`
      : "跟练（点击关闭）";
    learnStatus.show();
  };

  const pushLearnUi = (feedback: LearnFeedback = learnFeedback): void => {
    learnFeedback = feedback;
    const uri = learnUri();
    if (!learnActive) {
      broadcastLearn(undefined, null);
      syncLearnChrome();
      sidebar?.refreshRecorder();
      sidebar?.refreshLearnHud();
      return;
    }
    broadcastLearn(uri, { ...learnUiState(learnNotes, learnIndex, learnFeedback) });
    syncLearnChrome();
    sidebar?.refreshRecorder();
    sidebar?.refreshLearnHud();
  };

  const seekLearnStep = (stepIndex: number): void => {
    const stepSec = learnStepSec;
    if (!(stepSec > 0)) return;
    const learnUri = learnDocumentUri;
    const document = (learnUri
      ? vscode.workspace.textDocuments.find((item) => item.uri.toString() === learnUri.toString())
      : undefined)
      ?? getActiveGridDocument()
      ?? activeDawDocument();
    if (document) {
      const text = document.getText();
      const session = parseSession(text);
      currentDuration = scoreDurationSec(session);
      source = { uri: document.uri, text };
      const lines = text.split(/\r?\n/);
      rememberSession(session, `${document.uri.toString()}:${document.version}`, (i) => lines[i]);
    }
    seekTo(stepIndex * stepSec, { audio: false, chrome: false });
    if (learnDocumentUri) broadcastPlayhead(learnDocumentUri, stepIndex);
    pushTransportChrome();
  };

  const stopMelodyLearn = (): void => {
    learnActive = false;
    learnNotes = [];
    learnIndex = 0;
    learnFeedback = "idle";
    learnDocumentUri = undefined;
    learnStepSec = 0;
    learnFileLabel = "";
    if (learnFeedbackTimer) clearTimeout(learnFeedbackTimer);
    learnFeedbackTimer = undefined;
    pushLearnUi();
    updateStatus();
  };

  const startMelodyLearn = async (): Promise<void> => {
    const document = getActiveGridDocument() ?? activeDawDocument();
    if (!document) {
      void vscode.window.showWarningMessage("请先打开 .daw 工程（建议用网格编辑器）");
      return;
    }
    const session = parseSession(document.getText() || emptyTemplate());
    let track = session.tracks.find((item) => item.name === armedTrackName);
    if (!track || track.role === "drums") {
      track = session.tracks.find((item) => isPitchRole(item.role));
    }
    if (!track) {
      void vscode.window.showWarningMessage("没有可练的音高轨（钢琴 / 吉他 / 贝斯）");
      return;
    }
    const stepSec = stepDurationSec(session);
    const fromStep = stepSec > 0 ? Math.floor(currentPosition / stepSec) : 0;
    learnNotes = extractMelody(track, fromStep);
    if (!learnNotes.length) {
      void vscode.window.showWarningMessage("当前位置之后没有旋律起音可练");
      return;
    }
    learnActive = true;
    learnIndex = 0;
    learnFeedback = "idle";
    learnDocumentUri = document.uri;
    learnStepSec = stepSec;
    learnFileLabel = path.basename(document.uri.fsPath || document.uri.path);
    armedTrackName = track.name;
    armedFallbackRole = track.role;
    applyRoleOctave(track.role);
    if (!padMode.enabled) {
      await padMode.set(true);
      withAudio(() => audio.warmUp());
    }
    seekLearnStep(learnNotes[0]!.step);
    pushLearnUi("idle");
    void sidebar?.revealLearnHud();
    updateStatus();
  };

  setLearnReadyHandler((uri) => {
    if (!learnActive || !learnDocumentUri) return;
    if (uri.toString() !== learnDocumentUri.toString()) return;
    pushLearnUi(learnFeedback);
  });

  setActiveGridChangeHandler(() => {
    setPlayingContext();
    updateEditorChrome();
    sidebar?.refreshRecorder();
    sidebar?.refreshPlaylist();
  });

  register("vsDaw.toggleMelodyLearn", async () => {
    if (learnActive) stopMelodyLearn();
    else await startMelodyLearn();
  });

  register("vsDaw.padHit", async (key: string) => {
    const resolved = resolvePadNote(String(key).toLowerCase());
    if (!resolved) return;
    // 侧边栏点击始终可试听；键盘出声仍由 keybinding 的 padMode when 子句约束
    withAudio(() => audio.noteOn(resolved.note, resolved.velocity, resolved.channel, resolved.program));
    if (learnActive) {
      const expected = learnNotes[learnIndex];
      if (!expected) {
        pushLearnUi("done");
        return;
      }
      if (resolved.note === expected.midi) {
        learnIndex += 1;
        if (learnIndex >= learnNotes.length) {
          pushLearnUi("done");
          return;
        }
        seekLearnStep(learnNotes[learnIndex]!.step);
        pushLearnUi("correct");
        if (learnFeedbackTimer) clearTimeout(learnFeedbackTimer);
        learnFeedbackTimer = setTimeout(() => {
          if (learnActive && learnFeedback === "correct") pushLearnUi("idle");
        }, 280);
        return;
      }
      pushLearnUi("wrong");
      if (learnFeedbackTimer) clearTimeout(learnFeedbackTimer);
      learnFeedbackTimer = setTimeout(() => {
        if (learnActive && learnFeedback === "wrong") pushLearnUi("idle");
      }, 480);
      return;
    }
    if (!recordingMode.enabled) return;
    const editor = activeDawEditor();
    const document = activeDawDocument();
    if (!document) {
      void vscode.window.showWarningMessage("录制需要先打开 .daw 工程");
      return;
    }
    if (!armedTrack()) {
      void vscode.window.showWarningMessage(`当前工程没有轨「${armedTrackName}」，请先切换乐器`);
      return;
    }
    const session = parseSession(document.getText() || emptyTemplate());
    const step = Math.max(
      0,
      Math.min(
        Math.floor(currentPosition / stepDurationSec(session)),
        Math.max(0, ...session.tracks.flatMap((t) => t.rows.map((r) => r.cells.length))) || 31,
      ),
    );
    let targetStep = step;
    if (editor) {
      const caretStep = columnToStep(
        editor.document.lineAt(editor.selection.active.line).text,
        editor.selection.active.character,
      );
      if (Number.isFinite(caretStep)) targetStep = caretStep;
    }
    const next = writeHit(document.getText(), resolved.rowId, targetStep, armedTrackName);
    if (editor) await replaceDocument(editor, next);
    else await replaceDocumentText(document, next);
  });
  register("vsDaw.pickTrack", async () => {
    const session = currentSession();
    const roleLabel = ROLE_LABEL_ZH;
    const items = session?.tracks.length
      ? session.tracks.map((track) => ({
        label: track.name === armedTrackName
          ? `$(check) ${roleLabel[track.role]} · ${track.name}`
          : `${roleLabel[track.role]} · ${track.name}`,
        description: track.role,
        name: track.name,
        role: track.role,
      }))
      : ROLE_PICK.map((item) => ({
        label: item.role === armedFallbackRole
          ? `$(check) ${item.label}`
          : item.label,
        description: "未打开工程时仅试听",
        name: item.name,
        role: item.role,
      }));
    const picked = await vscode.window.showQuickPick(items, {
      title: "切换乐器",
      placeHolder: "Pad 与录制将使用该轨",
    });
    if (!picked) return;
    armedTrackName = picked.name;
    armedFallbackRole = picked.role;
    applyRoleOctave(picked.role);
    updateStatus();
  });
  register("vsDaw.octaveUp", () => {
    // 钢琴四排顶到约 C7；吉他/贝斯三排
    const role = armedRole();
    const max = role === "bass" ? 3 : role === "keys" ? 4 : 5;
    octave = Math.min(max, octave + 1);
    updateStatus();
  });
  register("vsDaw.octaveDown", () => {
    const min = armedRole() === "bass" ? 0 : 1;
    octave = Math.max(min, octave - 1);
    updateStatus();
  });
  const seekTo = (sec: number, options?: { audio?: boolean; chrome?: boolean }): void => {
    if (!Number.isFinite(sec)) return;
    const duration = currentDuration > 0
      ? currentDuration
      : (sessionCache ? scoreDurationSec(sessionCache) : 0);
    const target = Math.max(0, Math.min(Number(sec), duration || Number(sec)));
    const wall = nowSec();
    currentPosition = target;
    if (transport.status === "playing") {
      transport = {
        ...transport,
        status: "playing",
        anchorScoreSec: target,
        anchorWallSec: wall,
      };
    } else {
      transport = {
        ...transport,
        status: "paused",
        anchorScoreSec: target,
        anchorWallSec: wall,
      };
    }
    if (options?.audio !== false && audio.hasBuffer) {
      withAudio(() => audio.seek(target));
    }
    if (options?.chrome === false) {
      updatePlayhead(true);
      return;
    }
    updateStatus();
  };

  register("vsDaw.seek", (sec: number) => {
    if (!source) {
      const document = activeDawDocument();
      if (!document) return;
      source = { uri: document.uri, text: document.getText() };
      const session = parseSession(source.text);
      const lines = source.text.split(/\r?\n/);
      rememberSession(session, `${document.uri.toString()}:${document.version}`, (i) => lines[i]);
      currentDuration = scoreDurationSec(session);
    }
    seekTo(sec);
  });

  /** 在格子行上鼠标点选/拖动 → 按列 seek（装饰无法拖拽，用光标位置充当定位器）。 */
  const GRID_ROW_RE = /^[A-Za-z#][A-Za-z0-9#_^-]{0,15}(?:\s+|\s*(?=\|)).*\|/;
  let lastScrubAudioMs = 0;

  setGridSeekByStepHandler((uri, stepIndex) => {
    const document = vscode.workspace.textDocuments.find(
      (item) => item.uri.toString() === uri.toString(),
    ) ?? (getActiveGridDocument()?.uri.toString() === uri.toString()
      ? getActiveGridDocument()
      : undefined);
    if (!document) return;
    const text = document.getText();
    const session = parseSession(text);
    const stepSec = stepDurationSec(session);
    if (!(stepSec > 0)) return;
    currentDuration = scoreDurationSec(session);
    source = { uri: document.uri, text };
    const lines = text.split(/\r?\n/);
    rememberSession(session, `${document.uri.toString()}:${document.version}`, (i) => lines[i]);
    const now = Date.now();
    const shouldAudio = audio.hasBuffer
      && (transport.status !== "playing" || now - lastScrubAudioMs >= 80);
    if (shouldAudio) lastScrubAudioMs = now;
    seekTo(stepIndex * stepSec, {
      audio: shouldAudio,
      chrome: false,
    });
    pushTransportChrome();
    setTimeout(() => {
      sidebar?.refreshPlaylist();
      sidebar?.refreshRecorder();
    }, 0);
  });

  const scrubFromMouse = (editor: vscode.TextEditor, line: number, character: number): void => {
    const lineText = editor.document.lineAt(line).text;
    if (!GRID_ROW_RE.test(lineText)) return;

    const uriKey = editor.document.uri.toString();
    const isSource = Boolean(source?.uri && source.uri.toString() === uriKey);
    if (transport.status === "playing" && source?.uri && !isSource) return;

    const key = `${uriKey}:${editor.document.version}`;
    let session = sessionCache;
    if (!session || sessionDocKey !== key) {
      const text = editor.document.getText();
      const lines = text.split(/\r?\n/);
      session = rememberSession(parseSession(text), key, (index) => lines[index]);
    }
    const stepSec = stepDurationSec(session);
    if (!(stepSec > 0)) return;
    currentDuration = scoreDurationSec(session);
    if (!source || !isSource) {
      source = { uri: editor.document.uri, text: editor.document.getText() };
    }

    const step = columnToStep(lineText, character);
    const target = step * stepSec;
    const now = Date.now();
    const shouldAudio = audio.hasBuffer
      && isSource
      && (transport.status !== "playing" || now - lastScrubAudioMs >= 80);
    if (shouldAudio) lastScrubAudioMs = now;

    seekTo(target, {
      audio: shouldAudio,
      chrome: false,
    });
    pushTransportChrome();
    setTimeout(() => {
      sidebar?.refreshPlaylist();
    }, 0);
  };
  register("vsDaw.exportMidi", async () => {
    const text = currentSource()?.text;
    if (!text) {
      void vscode.window.showWarningMessage("没有可导出的工程");
      return;
    }
    const session = parseSession(text);
    const notes = scheduleSession(session);
    if (sessionHasSampleTracks(session)) {
      const answer = await vscode.window.showWarningMessage(
        "采样只能留在 .daw 包里，标准 MIDI 无法携带采样音频。确认后将跳过采样轨并导出其余轨。",
        { modal: true },
        "跳过采样并导出",
      );
      if (answer !== "跳过采样并导出") return;
    }
    const bytes = encodeMidi(session, midiNotesOnly(notes));
    const uri = await vscode.window.showSaveDialog({
      filters: { MIDI: ["mid", "midi"] },
      defaultUri: source?.uri
        ? vscode.Uri.file(source.uri.fsPath.replace(/\.daw$/i, ".mid"))
        : undefined,
    });
    if (!uri) return;
    await vscode.workspace.fs.writeFile(uri, bytes);
    void vscode.window.showInformationMessage(`已导出 ${path.basename(uri.fsPath)}`);
  });

  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (document) => {
    const pkg = packageForCacheFile(document.uri.fsPath);
    if (!pkg) return;
    try {
      await repackPackage(pkg);
    } catch (error) {
      void vscode.window.showErrorMessage(`写回 DAW 包失败：${(error as Error).message}`);
    }
  }));
  register("vsDaw.importMidi", async () => {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { MIDI: ["mid", "midi"] },
    });
    if (!picked?.[0]) return;
    const bytes = await vscode.workspace.fs.readFile(picked[0]);
    const session = decodeMidiToSession(bytes);
    const content = formatSessionText(session);
    const base = path.basename(picked[0].fsPath).replace(/\.(mid|midi)$/i, "");
    const target = path.join(libraryRoot, `${base}.daw`);
    await vscode.workspace.fs.writeFile(vscode.Uri.file(target), Buffer.from(content, "utf8"));
    sidebar?.refreshPlaylist();
    await vscode.commands.executeCommand(
      "vscode.openWith",
      vscode.Uri.file(target),
      GRID_VIEW_TYPE,
    );
  });

  context.subscriptions.push(
    playhead,
    output,
    { dispose: () => audio.dispose() },
    registerGridEditor(context),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) ensureDawLanguage(editor.document);
      if (isDrumEditor(editor) && getPadModeOnOpen()) {
        armPianoForPad();
        void padMode.set(true);
      }
      updateEditorChrome();
      updatePlayhead(true);
      sidebar?.refreshRecorder();
      sidebar?.refreshPlaylist();
    }),
    vscode.workspace.onDidOpenTextDocument((document) => ensureDawLanguage(document)),
    vscode.window.onDidChangeVisibleTextEditors(() => updatePlayhead(true)),
    vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
      if (isDrumEditor(event.textEditor)) updatePlayhead(true);
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (event.kind !== vscode.TextEditorSelectionChangeKind.Mouse) return;
      if (!isDrumEditor(event.textEditor) || event.selections.length !== 1) return;
      const active = event.selections[0].active;
      scrubFromMouse(event.textEditor, active.line, active.character);
    }),
  );

  void vscode.commands.executeCommand("setContext", "vsDaw.playing", false);
  void vscode.commands.executeCommand("setContext", "vsDaw.learnActive", false);
  if (vscode.window.activeTextEditor) {
    ensureDawLanguage(vscode.window.activeTextEditor.document);
  }
  updateEditorChrome();

  sidebar = registerSidebar(context, libraryRoot, {
    getLearnHudState: () => {
      const learn = learnActive
        ? learnUiState(learnNotes, learnIndex, learnFeedback)
        : undefined;
      return {
        active: learnActive,
        pitch: learn?.pitch ?? "",
        index: learn?.index ?? 0,
        total: learn?.total ?? 0,
        feedback: learn?.feedback ?? "idle",
        fileLabel: learnFileLabel,
      };
    },
    getRecorderState: () => {
      const { bpm, label } = positionLabel();
      const session = currentSession();
      const learn = learnActive
        ? learnUiState(learnNotes, learnIndex, learnFeedback)
        : undefined;
      return {
        padEnabled: padMode.enabled,
        recordingEnabled: recordingMode.enabled,
        playing: transport.status === "playing" && transportOwnsActiveDoc(),
        bpm,
        position: label,
        positionSec: currentPosition,
        durationSec: currentDuration,
        audioState: audioBroken
          ? "启动失败"
          : audio.contextState === "closed" ? "未启动" : audio.contextState,
        keyMap: getKeyMap(),
        tracks: (session?.tracks ?? []).map((item) => ({ name: item.name, role: item.role })),
        armedTrackName,
        armedRole: armedRole(),
        octave,
        learnActive,
        learnPitch: learn?.pitch ?? "",
        learnIndex: learn?.index ?? 0,
        learnTotal: learn?.total ?? 0,
        learnFeedback: learn?.feedback ?? "idle",
        learnFileLabel,
      };
    },
    syncLibrary: async () => {
      const copied = await ensureLibrary(libraryRoot, bundledExamplesDir);
      void vscode.window.showInformationMessage(
        copied.length === 0
          ? "示例已全部存在"
          : `已同步 ${copied.length} 首示例到 ~/.vs-daw`,
      );
      sidebar?.refreshPlaylist();
    },
    getPlaylistState: () => {
      let currentPath = source?.packagePath
        ?? (source?.uri?.fsPath ? path.normalize(source.uri.fsPath) : undefined);
      if (currentPath) {
        const pkg = packageForCacheFile(currentPath);
        if (pkg) currentPath = pkg;
      }
      return { currentPath, status: transport.status };
    },
    playScoreFile: async (absolutePath) => {
      const current = source?.packagePath ?? source?.uri?.fsPath;
      if (
        current
        && path.normalize(current) === path.normalize(absolutePath)
        && transport.status === "paused"
      ) {
        await applyTransport({ type: "play" });
        return;
      }
      if (await isDawPackageFile(absolutePath)) {
        const text = await readPackageIndex(absolutePath);
        await applyTransport(
          { type: "restart" },
          { uri: vscode.Uri.file(absolutePath), text, packagePath: absolutePath },
        );
        return;
      }
      const text = await readLibraryScore(libraryRoot, absolutePath);
      await applyTransport(
        { type: "restart" },
        { uri: vscode.Uri.file(absolutePath), text },
      );
    },
    pauseScoreFile: async (absolutePath) => {
      const current = source?.packagePath ?? source?.uri?.fsPath;
      if (
        !current
        || path.normalize(current) !== path.normalize(absolutePath)
        || transport.status !== "playing"
      ) return;
      await applyTransport({ type: "pause" });
    },
  });
  updateStatus();
  withAudio(() => audio.warmUp());
}

export function deactivate(): void {
  engine?.dispose();
  engine = undefined;
}
