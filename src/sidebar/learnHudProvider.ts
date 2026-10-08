import * as vscode from "vscode";

export interface LearnHudState {
  active: boolean;
  pitch: string;
  index: number;
  total: number;
  feedback: string;
  fileLabel: string;
}

/** 工作区底部 Panel 常驻条：与编辑器 tab 无关。 */
export class LearnHudProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(private readonly getState: () => LearnHudState) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.render();
    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === "command" && typeof message.command === "string") {
        await vscode.commands.executeCommand(message.command, ...(message.args ?? []));
      }
    });
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) this.refresh();
    });
    this.refresh();
  }

  refresh(): void {
    if (!this.view) return;
    void this.view.webview.postMessage({ type: "state", state: this.getState() });
  }

  async reveal(): Promise<void> {
    await vscode.commands.executeCommand("vsDaw.learnHud.focus");
  }

  private render(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body {
    margin: 0;
    padding: 6px 10px;
    font: 12px/1.3 var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: transparent;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 28px;
  }
  .idle { opacity: 0.55; }
  .pitch {
    font: 600 18px/1 var(--vscode-editor-font-family, ui-monospace, Menlo, monospace);
    color: #4ec9b0;
    min-width: 3.2em;
  }
  .meta { opacity: 0.75; font-variant-numeric: tabular-nums; }
  .hint { opacity: 0.7; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button {
    border: 1px solid var(--vscode-widget-border, rgba(127,127,127,0.4));
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    font: inherit;
  }
  .wrong .pitch { color: var(--vscode-errorForeground, #f14c4c); }
</style>
</head>
<body>
  <div id="root" class="row idle"><span class="hint">跟练未开启</span></div>
<script>
const vscode = acquireVsCodeApi();
const root = document.getElementById('root');
function paint(s) {
  if (!s || !s.active) {
    root.className = 'row idle';
    root.innerHTML = '<span class="hint">跟练未开启</span><button type="button" id="go">开启</button>';
    document.getElementById('go').onclick = () => vscode.postMessage({ type: 'command', command: 'vsDaw.toggleMelodyLearn' });
    return;
  }
  const done = s.feedback === 'done' || !s.total;
  const progress = done
    ? (s.total + '/' + s.total)
    : (Math.min((s.index || 0) + 1, s.total || 0) + '/' + (s.total || 0));
  let hint = s.fileLabel || '';
  if (s.feedback === 'wrong') hint = '不对 · ' + (s.pitch || '');
  else if (s.feedback === 'correct') hint = 'ok';
  else if (done) hint = '完成' + (s.fileLabel ? ' · ' + s.fileLabel : '');
  root.className = 'row' + (s.feedback === 'wrong' ? ' wrong' : '');
  root.innerHTML =
    '<span class="pitch">' + (done ? '完成' : (s.pitch || '—')) + '</span>' +
    '<span class="meta">' + progress + '</span>' +
    '<span class="hint">' + hint + '</span>' +
    '<button type="button" id="x">关</button>';
  document.getElementById('x').onclick = () => vscode.postMessage({ type: 'command', command: 'vsDaw.toggleMelodyLearn' });
}
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'state') paint(e.data.state);
});
</script>
</body>
</html>`;
  }
}
