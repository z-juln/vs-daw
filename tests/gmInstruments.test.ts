import {
  instrumentsForRole,
  programLabel,
  programUiNumber,
  GM_PROGRAM_LABEL_ZH,
} from "../src/midi/gm";

test("GM 音色表覆盖 0–127", () => {
  expect(GM_PROGRAM_LABEL_ZH).toHaveLength(128);
  expect(programLabel(108)).toBe("卡林巴");
  expect(programLabel(109)).toBe("风笛");
});

test("UI 音色号相对文件值 +1", () => {
  expect(programUiNumber(0)).toBe(1);
  expect(programUiNumber(108)).toBe(109);
  expect(programUiNumber(127)).toBe(128);
});

test("ethnic / fx 子分类列出具体乐器", () => {
  const ethnic = instrumentsForRole("ethnic");
  expect(ethnic.map((item) => item.program)).toEqual([
    104, 105, 106, 107, 108, 109, 110, 111,
  ]);
  expect(ethnic.find((item) => item.program === 108)?.label).toBe("卡林巴");

  const fx = instrumentsForRole("fx");
  expect(fx[0]?.program).toBe(96);
  expect(fx.at(-1)?.program).toBe(127);
  expect(fx).toHaveLength(8 + 16);
});

test("鼓与采样无子音色列表", () => {
  expect(instrumentsForRole("drums")).toEqual([]);
  expect(instrumentsForRole("sample")).toEqual([]);
});
