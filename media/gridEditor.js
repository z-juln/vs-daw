(function () {
  const vscode = acquireVsCodeApi();
  const trackSelect = document.getElementById("track");
  const bpmInput = document.getElementById("bpm");
  const meterInput = document.getElementById("meter");
  const stepsInput = document.getElementById("steps");
  const swingInput = document.getElementById("swing");
  const offsetWrap = document.getElementById("offsetWrap");
  const sampleOffsetInput = document.getElementById("sampleOffset");
  const warnEl = document.getElementById("warn");
  const scroller = document.getElementById("scroller");
  const emptyEl = document.getElementById("empty");
  const learnToggle = document.getElementById("learnToggle");
  const learnDock = document.getElementById("learnDock");
  const learnPanel = document.getElementById("learnPanel");
  const learnPitch = document.getElementById("learnPitch");
  const learnMeta = document.getElementById("learnMeta");
  const learnHint = document.getElementById("learnHint");
  const learnExit = document.getElementById("learnExit");

  let view = null;
  let playheadStep = -1;
  let suppressHeader = false;
  let scrubbing = false;
  let learnState = null;

  function post(message) {
    vscode.postMessage(message);
  }

  function isOnset(ch) {
    return ch && ch !== "." && ch !== "-";
  }

  function stepFromEvent(event) {
    const el = event.target.closest("[data-step]");
    if (!el) return null;
    const step = Number(el.dataset.step);
    return Number.isFinite(step) ? step : null;
  }

  function emitSeek(step) {
    if (!Number.isFinite(step) || step < 0) return;
    paintPlayhead(step);
    post({ type: "seekStep", stepIndex: step });
  }

  function clearLearnMarks() {
    for (const el of document.querySelectorAll(".learn-target, .learn-flash")) {
      el.classList.remove("learn-target", "learn-flash");
    }
  }

  function paintLearnMarks() {
    clearLearnMarks();
    if (!learnState || !learnState.active || learnState.step < 0 || !learnState.pitch) return;
    const step = learnState.step;
    const pitch = learnState.pitch;
    for (const el of document.querySelectorAll(`[data-step="${step}"]`)) {
      el.classList.add("learn-target");
    }
    for (const el of document.querySelectorAll("th.pitch")) {
      if (el.textContent === pitch) el.classList.add("learn-target");
    }
    for (const el of document.querySelectorAll("td.cell")) {
      if (el.dataset.rowId === pitch && Number(el.dataset.step) === step) {
        el.classList.add("learn-target");
        if (learnState.feedback === "wrong") el.classList.add("learn-flash");
      }
    }
    if (learnState.feedback === "wrong") {
      for (const el of document.querySelectorAll("th.pitch")) {
        if (el.textContent === pitch) el.classList.add("learn-flash");
      }
    }
  }

  function applyLearnUi() {
    if (!learnToggle || !learnDock || !learnPanel) return;
    const active = Boolean(learnState && learnState.active);
    learnToggle.classList.toggle("on", active);
    learnToggle.textContent = active ? "跟练中" : "跟练";
    learnDock.hidden = !active;
    if (!active) {
      clearLearnMarks();
      learnPanel.classList.remove("wrong", "correct");
      return;
    }
    const done = learnState.feedback === "done" || learnState.total === 0;
    learnPitch.textContent = done ? "完成" : (learnState.pitch || "—");
    learnMeta.textContent = done
      ? `${learnState.total}/${learnState.total}`
      : `${Math.min(learnState.index + 1, learnState.total)}/${learnState.total}`;
    if (learnState.feedback === "wrong") {
      learnHint.textContent = `不对 · ${learnState.pitch}`;
      learnPanel.classList.remove("correct");
      learnPanel.classList.remove("wrong");
      void learnPanel.offsetWidth;
      learnPanel.classList.add("wrong");
    } else if (learnState.feedback === "correct") {
      learnHint.textContent = "ok";
      learnPanel.classList.remove("wrong");
      learnPanel.classList.add("correct");
    } else if (done) {
      learnHint.textContent = "完成";
      learnPanel.classList.remove("wrong");
      learnPanel.classList.add("correct");
    } else {
      learnHint.textContent = "";
      learnPanel.classList.remove("wrong", "correct");
    }
    paintLearnMarks();
    if (learnState.step >= 0) {
      const cell = document.querySelector(`td.cell[data-step="${learnState.step}"]`);
      cell?.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }

  function render() {
    if (!view) return;
    suppressHeader = true;
    trackSelect.innerHTML = "";
    for (const name of view.trackNames) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      if (name === view.trackName) opt.selected = true;
      trackSelect.appendChild(opt);
    }
    bpmInput.value = String(view.bpm);
    meterInput.value = view.meter;
    stepsInput.value = String(view.stepsPerBar);
    swingInput.value = String(view.swing);
    if (offsetWrap && sampleOffsetInput) {
      const isSample = view.trackRole === "sample";
      offsetWrap.hidden = !isSample;
      if (isSample) {
        sampleOffsetInput.value = String(
          Number.isFinite(view.sampleOffsetSec) ? view.sampleOffsetSec : 0,
        );
      }
    }
    suppressHeader = false;

    if (view.warnings && view.warnings.length) {
      warnEl.hidden = false;
      warnEl.textContent = view.warnings
        .map((w) => (w.line === undefined ? w.message : `L${w.line + 1}: ${w.message}`))
        .join(" · ");
    } else {
      warnEl.hidden = true;
      warnEl.textContent = "";
    }

    if (!view.rows.length) {
      emptyEl.hidden = false;
      scroller.hidden = true;
      scroller.innerHTML = "";
      applyLearnUi();
      return;
    }
    emptyEl.hidden = true;
    scroller.hidden = false;

    const steps = view.rows.reduce((max, row) => Math.max(max, row.cells.length), 0);
    const stepsPerBar = Math.max(1, view.stepsPerBar || 4);
    const table = document.createElement("table");
    table.className = "grid";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const corner = document.createElement("th");
    corner.className = "pitch";
    corner.textContent = "";
    headRow.appendChild(corner);
    for (let step = 0; step < steps; step++) {
      const th = document.createElement("th");
      th.className = "step" + (step === playheadStep ? " playhead" : "");
      th.dataset.step = String(step);
      th.textContent = String((step % stepsPerBar) + 1);
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of view.rows) {
      const tr = document.createElement("tr");
      const pitch = document.createElement("th");
      pitch.className = "pitch sticky";
      pitch.textContent = row.id;
      tr.appendChild(pitch);
      for (let step = 0; step < steps; step++) {
        const ch = row.cells[step] ?? ".";
        const td = document.createElement("td");
        td.className = "cell";
        if (isOnset(ch)) td.classList.add(ch === "=" ? "hold" : "onset");
        if (step % stepsPerBar === 0) td.classList.add("bar-start");
        if (step === playheadStep) td.classList.add("playhead");
        td.dataset.rowId = row.id;
        td.dataset.step = String(step);
        td.textContent = ch === "." ? "·" : ch;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    scroller.innerHTML = "";
    scroller.appendChild(table);
    applyLearnUi();
  }

  function paintPlayhead(step) {
    playheadStep = step;
    for (const el of document.querySelectorAll(".playhead")) {
      el.classList.remove("playhead");
    }
    if (step < 0) return;
    for (const el of document.querySelectorAll(`[data-step="${step}"]`)) {
      el.classList.add("playhead");
    }
  }

  scroller.addEventListener("dblclick", (event) => {
    const td = event.target.closest("td.cell");
    if (!td || !view) return;
    event.preventDefault();
    post({
      type: "cellClick",
      trackName: view.trackName,
      rowId: td.dataset.rowId,
      stepIndex: Number(td.dataset.step),
      shift: Boolean(event.shiftKey),
    });
  });

  scroller.addEventListener("pointerdown", (event) => {
    if (event.detail > 1) return;
    const step = stepFromEvent(event);
    if (step === null) return;
    scrubbing = true;
    scroller.setPointerCapture?.(event.pointerId);
    emitSeek(step);
  });

  scroller.addEventListener("pointermove", (event) => {
    if (!scrubbing) return;
    const step = stepFromEvent(event);
    if (step === null) return;
    emitSeek(step);
  });

  const endScrub = (event) => {
    if (!scrubbing) return;
    scrubbing = false;
    try {
      scroller.releasePointerCapture?.(event.pointerId);
    } catch {
      // ignore
    }
  };
  scroller.addEventListener("pointerup", endScrub);
  scroller.addEventListener("pointercancel", endScrub);

  trackSelect.addEventListener("change", () => {
    post({ type: "selectTrack", trackName: trackSelect.value });
  });

  learnToggle?.addEventListener("click", () => post({ type: "toggleLearn" }));
  learnExit?.addEventListener("click", () => post({ type: "toggleLearn" }));

  function emitHeader() {
    if (suppressHeader || !view) return;
    post({
      type: "headerChange",
      fields: {
        bpm: Number(bpmInput.value),
        meter: meterInput.value,
        stepsPerBar: Number(stepsInput.value),
        swing: Number(swingInput.value),
      },
    });
  }

  for (const el of [bpmInput, meterInput, stepsInput, swingInput]) {
    el.addEventListener("change", emitHeader);
  }

  sampleOffsetInput?.addEventListener("change", () => {
    if (suppressHeader || !view) return;
    post({
      type: "sampleOffsetChange",
      trackName: view.trackName,
      offsetSec: Number(sampleOffsetInput.value),
    });
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.type === "session") {
      view = message.view;
      render();
      return;
    }
    if (message.type === "playhead") {
      paintPlayhead(Number(message.step));
      return;
    }
    if (message.type === "learn") {
      learnState = message.state;
      applyLearnUi();
    }
  });

  post({ type: "ready" });
})();
