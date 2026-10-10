import { normalizeSamplePath } from "./dawPackage";
import { DEFAULT_PLUGIN, TRACK_ROLES } from "./midi/gm";
import { pitchToMidi } from "./pitch";
import {
  CellKind,
  DawTrack,
  ParseWarning,
  Session,
  TrackRole,
} from "./types";
import { charToCell } from "./velocity";

const HEADER_RE = /^([A-Za-z][A-Za-z0-9_-]{0,15})\s*:\s*(.*)$/;
const TRACK_START_RE = /^track\s+([A-Za-z][A-Za-z0-9_-]{0,31})\s*$/i;
const ROW_RE = /^([A-Za-z#][A-Za-z0-9#_^-]{0,15})(?:\s+|\s*(?=\|))(.*)$/;
/** 采样行：assets/kick.wav 或 assets/kick.wav offset:-0.05 |...| */
const SAMPLE_ROW_RE =
  /^([A-Za-z0-9_./+-]+\.(?:wav|ogg|mp3|flac|aiff|aif))(?:\s+offset\s*:\s*(-?\d+(?:\.\d+)?))?(?:\s+|\s*(?=\|))(.*)$/i;

function parseOffsetSec(raw: string): number | null {
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed)) return null;
  // 合理范围：±60s，避免笔误拖垮时间线
  return Math.min(60, Math.max(-60, parsed));
}

function cellKind(char: string, warnings: ParseWarning[], line: number): CellKind {
  const cell = charToCell(char);
  if (cell) return cell;
  warnings.push({ message: `未知格子字符 "${char}"，按休止处理`, line });
  return "rest";
}

function parseGrid(
  raw: string,
  stepsPerBar: number,
  warnings: ParseWarning[],
  line: number,
): CellKind[] {
  const hasBars = raw.includes("|");
  let bars = hasBars
    ? raw.split("|").filter((part, index, all) =>
      part.length > 0 || (index > 0 && index < all.length - 1))
    : [raw.trim()];

  if (!hasBars) {
    const chars = bars[0].split("");
    bars = [];
    for (let index = 0; index < chars.length; index += stepsPerBar) {
      bars.push(chars.slice(index, index + stepsPerBar).join(""));
    }
  }

  return bars.flatMap((bar) => {
    const chars = bar.split("");
    if (chars.length < stepsPerBar) {
      warnings.push({ message: `小节不足 ${stepsPerBar} 格，已补休止`, line });
    } else if (chars.length > stepsPerBar) {
      warnings.push({ message: `小节超过 ${stepsPerBar} 格，已截断`, line });
    }
    return chars
      .slice(0, stepsPerBar)
      .concat(Array(Math.max(0, stepsPerBar - chars.length)).fill("."))
      .map((char) => cellKind(char, warnings, line));
  });
}

function inferRole(name: string): TrackRole {
  const lower = name.toLowerCase();
  if (lower.includes("drum") || lower === "perc" || lower === "beat") return "drums";
  if (lower.includes("bass")) return "bass";
  if (lower.includes("gtr") || lower.includes("guitar")) return "guitar";
  if (lower.includes("string") || lower.includes("violin") || lower.includes("cello")) return "strings";
  if (lower.includes("brass") || lower.includes("trumpet") || lower.includes("horn")) return "brass";
  if (lower.includes("wood") || lower.includes("flute") || lower.includes("sax") || lower.includes("clarinet")) {
    return "woodwind";
  }
  if (lower.includes("sample") || lower.includes("audio") || lower === "sfx") return "sample";
  if (lower.includes("pad") || lower.includes("synth")) return "pad";
  return "keys";
}

function parseRole(raw: string): TrackRole | null {
  const value = raw.trim().toLowerCase() as TrackRole;
  return TRACK_ROLES.includes(value) ? value : null;
}

export function parseSession(text: string): Session {
  let bpm = 120;
  let meter = "4/4";
  let stepsPerBar = 16;
  let swing = 0;
  let unsupportedVersion = false;
  const warnings: ParseWarning[] = [];
  const tracks: DawTrack[] = [];
  let current: DawTrack | undefined;
  let inTracks = false;

  text.split("\n").forEach((sourceLine, lineIndex) => {
    const line = sourceLine.replace(/\r$/, "");
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed.startsWith("#")) {
      const version = trimmed.match(/vs-daw\s+(\d+)/i);
      if (version && version[1] !== "1") unsupportedVersion = true;
      return;
    }

    const trackStart = trimmed.match(TRACK_START_RE);
    if (trackStart) {
      inTracks = true;
      current = {
        name: trackStart[1],
        role: inferRole(trackStart[1]),
        plugin: "",
        rows: [],
      };
      current.plugin = DEFAULT_PLUGIN[current.role];
      tracks.push(current);
      return;
    }

    const header = line.match(HEADER_RE);
    if (header) {
      const key = header[1].toLowerCase();
      const value = header[2].trim();
      if (!inTracks) {
        if (key === "bpm") {
          const parsed = Number(value);
          if (Number.isFinite(parsed) && parsed > 0) bpm = parsed;
          else warnings.push({ message: "bpm 无效，使用 120", line: lineIndex });
        } else if (key === "meter") {
          meter = value || "4/4";
        } else if (key === "steps") {
          const parsed = Number(value);
          if (Number.isInteger(parsed) && parsed > 0) stepsPerBar = parsed;
          else warnings.push({ message: "steps 无效，使用 16", line: lineIndex });
        } else if (key === "swing") {
          const parsed = Number(value);
          if (Number.isFinite(parsed)) swing = Math.min(100, Math.max(0, parsed));
          else warnings.push({ message: "swing 无效，使用 0", line: lineIndex });
        } else if (key === "version") {
          unsupportedVersion = value !== "1";
        } else {
          warnings.push({ message: `未知文件头 "${key}"`, line: lineIndex });
        }
        return;
      }

      if (!current) {
        warnings.push({ message: "轨属性出现在 track 之前", line: lineIndex });
        return;
      }
      if (key === "role") {
        const role = parseRole(value);
        if (!role) {
          warnings.push({ message: `未知 role "${value}"，使用 keys`, line: lineIndex });
          current.role = "keys";
        } else {
          current.role = role;
        }
        if (!current.plugin || current.plugin.endsWith(".gm")) {
          current.plugin = DEFAULT_PLUGIN[current.role];
        }
      } else if (key === "plugin") {
        current.plugin = value || DEFAULT_PLUGIN[current.role];
      } else if (key === "program") {
        const parsed = Number(value);
        if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 127) current.program = parsed;
        else warnings.push({ message: "program 无效", line: lineIndex });
      } else if (key === "channel") {
        const parsed = Number(value);
        if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 16) current.channel = parsed - 1;
        else warnings.push({ message: "channel 无效（1–16）", line: lineIndex });
      } else if (key === "offset") {
        const parsed = parseOffsetSec(value);
        if (parsed === null) warnings.push({ message: "offset 无效（秒）", line: lineIndex });
        else current.offsetSec = parsed;
      } else {
        warnings.push({ message: `未知轨属性 "${key}"`, line: lineIndex });
      }
      return;
    }

    const sampleRow = line.match(SAMPLE_ROW_RE);
    const row = sampleRow ?? line.match(ROW_RE);
    if (!row) {
      warnings.push({ message: "无法解析此行", line: lineIndex });
      return;
    }
    if (!current) {
      // Legacy single-block: invent a drums track for drum-like rows, else keys.
      const id = row[1];
      const role = sampleRow
        ? "sample"
        : pitchToMidi(id) !== null
          ? "keys"
          : "drums";
      current = {
        name: role === "drums" ? "drums" : role === "sample" ? "samples" : "keys",
        role,
        plugin: DEFAULT_PLUGIN[role],
        rows: [],
      };
      tracks.push(current);
      inTracks = true;
    }
    const id = sampleRow || current.role === "sample"
      ? normalizeSamplePath(row[1])
      : row[1];
    if (sampleRow && current.role !== "sample") {
      current.role = "sample";
      current.plugin = DEFAULT_PLUGIN.sample;
    }
    const gridRaw = sampleRow ? row[3].trim() : row[2].trim();
    const cells = parseGrid(gridRaw, stepsPerBar, warnings, lineIndex);
    let sampleOffsetSec: number | undefined;
    if (sampleRow && row[2] !== undefined && row[2] !== "") {
      const parsed = parseOffsetSec(row[2]);
      if (parsed === null) warnings.push({ message: "行 offset 无效（秒）", line: lineIndex });
      else sampleOffsetSec = parsed;
    }
    const existing = current.rows.findIndex((item) => item.id.toLowerCase() === id.toLowerCase());
    const gridRow = { id, cells, lineIndex, sampleOffsetSec };
    if (existing >= 0) current.rows[existing] = gridRow;
    else current.rows.push(gridRow);
  });

  const maxLength = tracks.reduce(
    (max, track) => Math.max(max, ...track.rows.map((row) => row.cells.length), 0),
    0,
  );
  tracks.forEach((track) => {
    track.rows.forEach((row) => {
      while (row.cells.length < maxLength) row.cells.push("rest");
    });
  });

  return {
    bpm,
    meter,
    stepsPerBar,
    swing,
    tracks,
    warnings,
    unsupportedVersion,
  };
}

/** @deprecated Use parseSession */
export const parseScore = parseSession;
