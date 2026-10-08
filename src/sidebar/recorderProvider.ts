import * as vscode from "vscode";
import { DEFAULT_KEY_MAP, DRUM_LABELS } from "../drums";
import { pitchPadRows } from "../padLayout";
import { TrackRole } from "../types";

const ROLE_LABEL: Record<TrackRole, string> = {
  drums: "鼓",
  keys: "钢琴",
  guitar: "吉他",
  bass: "贝斯",
};

export interface RecorderViewState {
  padEnabled: boolean;
  recordingEnabled: boolean;
  playing: boolean;
  bpm: number;
  position: string;
  positionSec: number;
  durationSec: number;
  audioState: string;
  keyMap: Record<string, string>;
  tracks: { name: string; role: TrackRole }[];
  armedTrackName: string;
  armedRole: TrackRole;
  octave: number;
  learnActive: boolean;
  learnPitch: string;
  learnIndex: number;
  learnTotal: number;
  learnFeedback: string;
  learnFileLabel: string;
}

function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export class RecorderProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(private readonly getState: () => RecorderViewState) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.render(this.getState());
    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (!message || typeof message !== "object") return;
      if (message.type === "command" && typeof message.command === "string") {
        await vscode.commands.executeCommand(message.command, ...(message.args ?? []));
      }
      if (message.type === "seek" && Number.isFinite(message.sec)) {
        await vscode.commands.executeCommand("vsDaw.seek", Number(message.sec));
      }
    });
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) this.refresh();
    });
  }

  refresh(): void {
    if (!this.view?.visible) return;
    const state = this.getState();
    void this.view.webview.postMessage({ type: "state", state: this.serialize(state) });
  }

  /** 播放中轻量刷新：只推进度，不重建垫子列表。 */
  tick(payload: {
    playing: boolean;
    position: string;
    positionSec: number;
    durationSec: number;
    bpm: number;
  }): void {
    if (!this.view?.visible) return;
    void this.view.webview.postMessage({
      type: "tick",
      playing: payload.playing,
      position: payload.position,
      positionSec: payload.positionSec,
      durationSec: payload.durationSec,
      bpm: payload.bpm,
      clock: `${formatClock(payload.positionSec)} / ${formatClock(payload.durationSec)}`,
      progressMax: Math.max(0.001, payload.durationSec),
    });
  }

  private serialize(state: RecorderViewState) {
    return {
      ...state,
      roleLabel: ROLE_LABEL[state.armedRole],
      clock: `${formatClock(state.positionSec)} / ${formatClock(state.durationSec)}`,
      progressMax: Math.max(0.001, state.durationSec),
      pads: this.pads(state),
    };
  }

  private pads(state: RecorderViewState): { key: string; label: string; group: string }[] {
    if (state.armedRole === "drums") {
      return Object.keys(DEFAULT_KEY_MAP)
        .filter((key) => state.keyMap[key])
        .map((key) => {
          const drumId = state.keyMap[key];
          const label = DRUM_LABELS[drumId as keyof typeof DRUM_LABELS] ?? drumId;
          return { key, label: `${key.toUpperCase()}　${label}`, group: "鼓垫" };
        });
    }
    return pitchPadRows(state.octave, { numberRow: state.armedRole === "keys" }).flatMap((row) =>
      row.keys.map((item) => ({
        key: item.key,
        label: `${item.key.toUpperCase()}　${item.label}`,
        group: row.title,
      })),
    );
  }

  private render(state: RecorderViewState): string {
    const initial = JSON.stringify(this.serialize(state));
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root {
    color-scheme: light dark;
    --gap: 8px;
    --radius: 6px;
  }
  body {
    margin: 0;
    padding: 10px 12px 16px;
    font: 12px/1.4 var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: transparent;
  }
  h3 {
    margin: 14px 0 8px;
    font-size: 11px;
    font-weight: 600;
    opacity: 0.75;
    text-transform: none;
  }
  h3:first-child { margin-top: 0; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; align-items: center; }
  button, .chip {
    border: 1px solid var(--vscode-button-border, transparent);
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border-radius: var(--radius);
    padding: 4px 8px;
    cursor: pointer;
    font: inherit;
  }
  button.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  button.on {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  button:hover { filter: brightness(1.08); }
  .meta { opacity: 0.8; flex: 1; min-width: 120px; }
  .learn-box {
    width: 100%;
    margin: 2px 0 6px;
    padding: 5px 8px;
    border-radius: var(--radius);
    border: 1px solid var(--vscode-widget-border, rgba(127,127,127,0.35));
    background: color-mix(in srgb, var(--vscode-editorWidget-background) 80%, transparent);
    box-sizing: border-box;
  }
  .learn-box.active {
    border-color: color-mix(in srgb, #4ec9b0 45%, transparent);
  }
  .learn-box.wrong {
    border-color: var(--vscode-errorForeground, #f14c4c);
  }
  .learn-box.correct, .learn-box.done {
    border-color: #4ec9b0;
  }
  .learn-pitch {
    font-size: 16px;
    font-weight: 650;
    font-family: var(--vscode-editor-font-family, ui-monospace, Menlo, monospace);
    color: #4ec9b0;
    line-height: 1.1;
  }
  .learn-sub { opacity: 0.75; margin-top: 1px; font-size: 11px; }
  .seek-wrap { width: 100%; margin: 4px 0 2px; }
  input[type="range"] {
    width: 100%;
    accent-color: var(--vscode-button-background);
    cursor: pointer;
  }
  .clock { font-variant-numeric: tabular-nums; opacity: 0.85; }
  .pads { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
  .pads button { text-align: left; padding: 6px 8px; }
  .group-label { grid-column: 1 / -1; margin-top: 4px; opacity: 0.65; font-size: 11px; }
  a.link { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: none; }
  a.link:hover { text-decoration: underline; }
</style>
</head>
<body>
  <h3>传输</h3>
  <div class="row">
    <button id="pad" type="button">Pad</button>
    <button id="rec" type="button">录制</button>
    <button id="learn" type="button">跟练</button>
    <button id="play" class="primary" type="button">播放</button>
    <button id="stop" type="button">停止</button>
  </div>
  <div id="learnBox" class="learn-box" hidden>
    <div id="learnPitch" class="learn-pitch">—</div>
    <div id="learnSub" class="learn-sub"></div>
  </div>
  <div class="row">
    <button id="track" type="button">乐器</button>
    <button id="octUp" type="button">升八度</button>
    <button id="octDown" type="button">降八度</button>
  </div>
  <div class="row">
    <span class="meta" id="meta"></span>
  </div>
  <div class="seek-wrap">
    <input id="seek" type="range" min="0" max="1" step="0.01" value="0" />
  </div>
  <div class="row">
    <span class="clock" id="clock">0:00 / 0:00</span>
    <span class="meta" id="pos"></span>
  </div>
  <div class="row">
    <button id="audio" type="button">音频引擎</button>
  </div>

  <h3 id="padsTitle">垫子</h3>
  <div class="pads" id="pads"></div>

  <h3>说明</h3>
  <div class="row">
    <a class="link" data-cmd="vsDaw.openManual" data-args='["skill"]'>工程格式手册</a>
    <a class="link" data-cmd="vsDaw.openManual" data-args='["readme"]'>使用说明</a>
  </div>

<script>
const vscode = acquireVsCodeApi();
let state = ${initial};
let dragging = false;

const $ = (id) => document.getElementById(id);
const post = (type, payload = {}) => vscode.postMessage({ type, ...payload });
const cmd = (command, ...args) => post('command', { command, args });

function renderTransport(s) {
  $('pad').textContent = 'Pad：' + (s.padEnabled ? 'ON' : 'OFF');
  $('pad').classList.toggle('on', s.padEnabled);
  $('rec').textContent = '录制：' + (s.recordingEnabled ? 'ON' : 'OFF');
  $('rec').classList.toggle('on', s.recordingEnabled);
  $('learn').textContent = s.learnActive ? '跟练：ON' : '跟练';
  $('learn').classList.toggle('on', !!s.learnActive);
  $('play').textContent = s.playing ? '暂停' : '播放';
  $('track').textContent = '乐器：' + s.roleLabel + ' · ' + s.armedTrackName;
  $('octUp').style.display = s.armedRole === 'drums' ? 'none' : '';
  $('octDown').style.display = s.armedRole === 'drums' ? 'none' : '';
  $('octUp').textContent = '低排 C' + s.octave + ' ↑';
  $('meta').textContent = s.bpm + ' BPM · 引擎 ' + s.audioState;
  $('pos').textContent = '位置 ' + s.position;
  $('clock').textContent = s.clock;
  $('audio').textContent = '音频引擎：' + s.audioState;
  const box = $('learnBox');
  const active = !!s.learnActive;
  box.hidden = !active;
  box.className = 'learn-box' + (active ? ' active' : '');
  if (active) {
    const done = s.learnFeedback === 'done' || !s.learnTotal;
    const fb = s.learnFeedback || 'idle';
    if (fb === 'wrong') box.classList.add('wrong');
    if (fb === 'correct' || fb === 'done') box.classList.add(fb === 'done' ? 'done' : 'correct');
    $('learnPitch').textContent = done ? '完成' : (s.learnPitch || '—');
    const progress = done
      ? (s.learnTotal + ' / ' + s.learnTotal)
      : (Math.min((s.learnIndex || 0) + 1, s.learnTotal || 0) + ' / ' + (s.learnTotal || 0));
    let hint = progress + (s.learnFileLabel ? ' · ' + s.learnFileLabel : '');
    if (fb === 'wrong') hint = '不对 · ' + s.learnPitch + ' · ' + progress;
    if (fb === 'correct') hint = 'ok · ' + progress;
    if (done) hint = '完成 · ' + progress + (s.learnFileLabel ? ' · ' + s.learnFileLabel : '');
    $('learnSub').textContent = hint;
  }
  if (!dragging) {
    $('seek').max = String(s.progressMax);
    $('seek').value = String(Math.min(s.positionSec, s.progressMax));
  }
}

function renderPads(s) {
  const pads = $('pads');
  pads.innerHTML = '';
  let lastGroup = '';
  for (const pad of s.pads || []) {
    if (pad.group !== lastGroup) {
      lastGroup = pad.group;
      const g = document.createElement('div');
      g.className = 'group-label';
      g.textContent = pad.group;
      pads.appendChild(g);
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = pad.label;
    b.addEventListener('click', () => cmd('vsDaw.padHit', pad.key));
    pads.appendChild(b);
  }
  $('padsTitle').textContent = s.armedRole === 'drums' ? '鼓垫（点击试听）' : '音阶（Shift=♯，点击试听）';
}

function render() {
  renderTransport(state);
  renderPads(state);
}

function applyTick(t) {
  state.playing = t.playing;
  state.position = t.position;
  state.positionSec = t.positionSec;
  state.durationSec = t.durationSec;
  state.bpm = t.bpm;
  state.clock = t.clock;
  state.progressMax = t.progressMax;
  $('play').textContent = t.playing ? '暂停' : '播放';
  $('pos').textContent = '位置 ' + t.position;
  $('clock').textContent = t.clock;
  $('meta').textContent = t.bpm + ' BPM · 引擎 ' + (state.audioState || '');
  if (!dragging) {
    $('seek').max = String(t.progressMax);
    $('seek').value = String(Math.min(t.positionSec, t.progressMax));
  }
}

$('pad').onclick = () => cmd('vsDaw.togglePadMode');
$('rec').onclick = () => cmd('vsDaw.toggleRecording');
$('learn').onclick = () => cmd('vsDaw.toggleMelodyLearn');
$('play').onclick = () => cmd('vsDaw.playPause');
$('stop').onclick = () => cmd('vsDaw.stop');
$('track').onclick = () => cmd('vsDaw.pickTrack');
$('octUp').onclick = () => cmd('vsDaw.octaveUp');
$('octDown').onclick = () => cmd('vsDaw.octaveDown');
$('audio').onclick = () => cmd('vsDaw.warmUpAudio');

const seek = $('seek');
function endSeek() {
  if (!dragging) return;
  dragging = false;
  post('seek', { sec: Number(seek.value) });
}
seek.addEventListener('pointerdown', () => { dragging = true; });
seek.addEventListener('pointerup', endSeek);
seek.addEventListener('pointercancel', endSeek);
seek.addEventListener('change', endSeek);
window.addEventListener('pointerup', endSeek);
seek.addEventListener('input', () => {
  if (!dragging) dragging = true;
  const sec = Number(seek.value);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const dur = state.durationSec || 0;
  const dm = Math.floor(dur / 60);
  const ds = Math.floor(dur % 60);
  $('clock').textContent = m + ':' + String(s).padStart(2,'0') + ' / ' + dm + ':' + String(ds).padStart(2,'0');
});

document.querySelectorAll('a.link').forEach((el) => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    const command = el.getAttribute('data-cmd');
    const args = JSON.parse(el.getAttribute('data-args') || '[]');
    cmd(command, ...args);
  });
});

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg) return;
  if (msg.type === 'tick') {
    applyTick(msg);
    return;
  }
  if (msg.type === 'state') {
    state = msg.state;
    render();
  }
});

render();
</script>
</body>
</html>`;
  }
}
