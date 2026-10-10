import * as vscode from "vscode";
import { isDawPackageFile, PACKAGE_INDEX } from "../dawPackage";
import { parseSession } from "../parser";
import { formatSessionText } from "../serialize";
import { applyCellEdit } from "./cellEdit";
import { applyHeaderFields, sessionToView } from "./sessionView";

export const GRID_VIEW_TYPE = "vsDaw.gridEditor";

interface GridPanel {
  document: vscode.TextDocument;
  webview: vscode.Webview;
  panel: vscode.WebviewPanel;
  selectedTrack?: string;
}

const panels = new Set<GridPanel>();
let activeGridDocument: vscode.TextDocument | undefined;
let seekByStepHandler: ((uri: vscode.Uri, stepIndex: number) => void) | undefined;
let learnReadyHandler: ((uri: vscode.Uri) => void) | undefined;
let activeGridChangeHandler: ((uri: vscode.Uri) => void) | undefined;

export function getActiveGridDocument(): vscode.TextDocument | undefined {
  for (const item of panels) {
    if (item.panel.active) return item.document;
  }
  return activeGridDocument;
}

export function setGridSeekByStepHandler(
  handler: ((uri: vscode.Uri, stepIndex: number) => void) | undefined,
): void {
  seekByStepHandler = handler;
}

export function setLearnReadyHandler(
  handler: ((uri: vscode.Uri) => void) | undefined,
): void {
  learnReadyHandler = handler;
}

export function setActiveGridChangeHandler(
  handler: ((uri: vscode.Uri) => void) | undefined,
): void {
  activeGridChangeHandler = handler;
}

export function broadcastPlayhead(uri: vscode.Uri | undefined, step: number): void {
  if (!uri) return;
  const key = uri.toString();
  for (const panel of panels) {
    if (panel.document.uri.toString() === key) {
      void panel.webview.postMessage({ type: "playhead", step });
    }
  }
}

export function broadcastLearn(
  uri: vscode.Uri | undefined,
  state: Record<string, unknown> | null,
): void {
  for (const panel of panels) {
    if (uri && panel.document.uri.toString() !== uri.toString()) continue;
    void panel.webview.postMessage({ type: "learn", state });
  }
}

function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "gridEditor.css"));
  const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "gridEditor.js"));
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `script-src ${webview.cspSource}`,
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${cssUri}" />
  <title>VS DAW Grid</title>
</head>
<body>
  <div class="toolbar">
    <label>轨 <select id="track"></select></label>
    <label>bpm <input id="bpm" type="number" min="1" max="400" step="1" /></label>
    <label>meter <input id="meter" type="text" size="6" /></label>
    <label>steps <input id="steps" type="number" min="1" max="64" step="1" /></label>
    <label>swing <input id="swing" type="number" min="0" max="1" step="0.05" /></label>
    <button id="learnToggle" type="button" class="learn-toggle">跟练</button>
  </div>
  <div id="warn" class="warn" hidden></div>
  <div id="empty" class="empty" hidden>当前轨没有音高行。可切回文本编辑器添加行，或用 Pad 录制。</div>
  <div id="scroller" class="scroller"></div>
  <div id="learnDock" class="learn-dock" hidden>
    <div id="learnPanel" class="learn-panel">
      <span id="learnPitch" class="learn-pitch">—</span>
      <span id="learnMeta" class="learn-meta">0/0</span>
      <span id="learnHint" class="learn-hint"></span>
      <button id="learnExit" type="button" class="learn-exit">关</button>
    </div>
  </div>
  <script src="${jsUri}"></script>
</body>
</html>`;
}

async function replaceDocumentText(document: vscode.TextDocument, text: string): Promise<boolean> {
  const edit = new vscode.WorkspaceEdit();
  const full = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length),
  );
  edit.replace(document.uri, full, text);
  return vscode.workspace.applyEdit(edit);
}

export class DawGridEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly extensionUri: vscode.Uri) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    if (document.uri.scheme === "file" && await isDawPackageFile(document.uri.fsPath)) {
      webviewPanel.webview.html = `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family);padding:16px;color:var(--vscode-foreground)">
        <p>这是 DAW 包（zip），不能直接打开。</p>
        <p>请在播放列表中展开该包，再打开内部的 <code>${PACKAGE_INDEX}</code> 或其它文件。</p>
      </body></html>`;
      return;
    }

    const panel: GridPanel = {
      document,
      webview: webviewPanel.webview,
      panel: webviewPanel,
    };
    panels.add(panel);
    activeGridDocument = document;

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webviewPanel.webview.html = getHtml(webviewPanel.webview, this.extensionUri);

    const pushSession = (): void => {
      const session = parseSession(document.getText());
      const view = sessionToView(session, panel.selectedTrack);
      panel.selectedTrack = view.trackName;
      void webviewPanel.webview.postMessage({ type: "session", view });
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== document.uri.toString()) return;
      pushSession();
    });

    webviewPanel.onDidChangeViewState((event) => {
      if (event.webviewPanel.active) {
        activeGridDocument = document;
        activeGridChangeHandler?.(document.uri);
      }
    });

    webviewPanel.onDidDispose(() => {
      changeSub.dispose();
      panels.delete(panel);
      if (activeGridDocument?.uri.toString() === document.uri.toString()) {
        activeGridDocument = [...panels].at(-1)?.document;
      }
    });

    webviewPanel.webview.onDidReceiveMessage(async (message) => {
      if (!message || typeof message !== "object") return;
      if (message.type === "ready") {
        pushSession();
        learnReadyHandler?.(document.uri);
        return;
      }
      if (message.type === "toggleLearn") {
        await vscode.commands.executeCommand("vsDaw.toggleMelodyLearn");
        return;
      }
      if (message.type === "selectTrack" && typeof message.trackName === "string") {
        panel.selectedTrack = message.trackName;
        pushSession();
        return;
      }
      if (message.type === "cellClick") {
        const trackName = String(message.trackName ?? "");
        const rowId = String(message.rowId ?? "");
        const stepIndex = Number(message.stepIndex);
        const shift = Boolean(message.shift);
        if (!trackName || !rowId || !Number.isFinite(stepIndex) || stepIndex < 0) return;
        const session = parseSession(document.getText());
        const next = applyCellEdit(session, trackName, rowId, stepIndex, shift);
        await replaceDocumentText(document, formatSessionText(next));
        return;
      }
      if (message.type === "seekStep") {
        const stepIndex = Number(message.stepIndex);
        if (!Number.isFinite(stepIndex) || stepIndex < 0) return;
        seekByStepHandler?.(document.uri, stepIndex);
        return;
      }
      if (message.type === "headerChange" && message.fields && typeof message.fields === "object") {
        const fields = message.fields as Record<string, unknown>;
        const session = parseSession(document.getText());
        const next = applyHeaderFields(session, {
          bpm: typeof fields.bpm === "number" && Number.isFinite(fields.bpm) ? fields.bpm : undefined,
          meter: typeof fields.meter === "string" ? fields.meter : undefined,
          stepsPerBar: typeof fields.stepsPerBar === "number" && Number.isFinite(fields.stepsPerBar)
            ? Math.max(1, Math.round(fields.stepsPerBar))
            : undefined,
          swing: typeof fields.swing === "number" && Number.isFinite(fields.swing)
            ? fields.swing
            : undefined,
        });
        await replaceDocumentText(document, formatSessionText(next));
      }
    });

    pushSession();
  }
}

export function registerGridEditor(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.window.registerCustomEditorProvider(
    GRID_VIEW_TYPE,
    new DawGridEditorProvider(context.extensionUri),
    {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    },
  );
}
