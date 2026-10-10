import {
  createTransport,
  positionAt,
  reduceTransport,
  resolveTransportAction,
} from "../src/transport";

test("播放、暂停和续播保持位置", () => {
  let transport = createTransport({ loop: true });
  transport = reduceTransport(transport, { type: "play" }, 10);
  expect(positionAt(transport, 11.25)).toBeCloseTo(1.25);
  transport = reduceTransport(transport, { type: "pause" }, 11.25);
  expect(positionAt(transport, 99)).toBeCloseTo(1.25);
  transport = reduceTransport(transport, { type: "play" }, 100);
  expect(positionAt(transport, 100)).toBeCloseTo(1.25);
});

test("restart 从零播放，stop 停止归零", () => {
  let transport = reduceTransport(createTransport({ loop: true }), { type: "play" }, 0);
  transport = reduceTransport(transport, { type: "restart" }, 3);
  expect(positionAt(transport, 3)).toBe(0);
  transport = reduceTransport(transport, { type: "stop" }, 4);
  expect(transport.status).toBe("stopped");
  expect(positionAt(transport, 99)).toBe(0);
});

test("循环在总时长处回绕", () => {
  const transport = reduceTransport(createTransport({ loop: true }), { type: "play" }, 0);
  expect(positionAt(transport, 5, 4)).toBe(1);
});

test("playPause 切换状态", () => {
  let transport = reduceTransport(createTransport({ loop: false }), { type: "playPause" }, 0);
  expect(transport.status).toBe("playing");
  transport = reduceTransport(transport, { type: "playPause" }, 1);
  expect(transport.status).toBe("paused");
});

test("播 A 时焦点在 B：playPause / play 应切到 B 重开", () => {
  expect(resolveTransportAction("playing", "playPause", "file:a", "file:b")).toBe("restart");
  expect(resolveTransportAction("playing", "play", "file:a", "file:b")).toBe("restart");
  expect(resolveTransportAction("playing", "playPause", "file:a", "file:a")).toBe("pause");
  expect(resolveTransportAction("paused", "playPause", "file:a", "file:b")).toBe("restart");
  expect(resolveTransportAction("stopped", "play", "file:a", "file:a")).toBe("play");
});
