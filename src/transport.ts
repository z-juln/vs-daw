import { TransportStatus } from "./types";

export interface TransportEngine {
  status: TransportStatus;
  loop: boolean;
  anchorWallSec: number;
  anchorScoreSec: number;
}

export type TransportEvent =
  | { type: "play" }
  | { type: "pause" }
  | { type: "playPause" }
  | { type: "restart" }
  | { type: "stop" };

export function createTransport(options: { loop: boolean }): TransportEngine {
  return {
    status: "stopped",
    loop: options.loop,
    anchorWallSec: 0,
    anchorScoreSec: 0,
  };
}

export function positionAt(
  transport: TransportEngine,
  wallSec: number,
  durationSec = Number.POSITIVE_INFINITY,
): number {
  if (transport.status !== "playing") return transport.anchorScoreSec;
  const raw = transport.anchorScoreSec + wallSec - transport.anchorWallSec;
  if (transport.loop && Number.isFinite(durationSec) && durationSec > 0) {
    return ((raw % durationSec) + durationSec) % durationSec;
  }
  return Math.min(Math.max(0, raw), durationSec);
}

/**
 * 将 UI 事件解析成实际动作。
 * 正在播 A、焦点已切到 B 时，play / playPause 应切到 B 重开，而不是暂停 A。
 */
export function resolveTransportAction(
  status: TransportStatus,
  eventType: TransportEvent["type"],
  loadedUri?: string,
  activeUri?: string,
): "play" | "pause" | "stop" | "restart" {
  const switching = Boolean(
    loadedUri
    && activeUri
    && loadedUri !== activeUri,
  );
  if (eventType === "stop" || eventType === "pause" || eventType === "restart") {
    return eventType;
  }
  if (eventType === "play") {
    return switching ? "restart" : "play";
  }
  // playPause
  if (status === "playing") {
    return switching ? "restart" : "pause";
  }
  return switching ? "restart" : "play";
}

export function reduceTransport(
  transport: TransportEngine,
  event: TransportEvent,
  nowSec: number,
): TransportEngine {
  const type = event.type === "playPause"
    ? transport.status === "playing" ? "pause" : "play"
    : event.type;
  if (type === "play") {
    return {
      ...transport,
      status: "playing",
      anchorWallSec: nowSec,
    };
  }
  if (type === "pause") {
    return {
      ...transport,
      status: "paused",
      anchorScoreSec: positionAt(transport, nowSec),
      anchorWallSec: nowSec,
    };
  }
  if (type === "restart") {
    return {
      ...transport,
      status: "playing",
      anchorWallSec: nowSec,
      anchorScoreSec: 0,
    };
  }
  return {
    ...transport,
    status: "stopped",
    anchorWallSec: nowSec,
    anchorScoreSec: 0,
  };
}
