import { DEFAULT_PROGRAM, roleFromProgram } from "../src/midi/gm";

describe("roleFromProgram", () => {
  it("按 GM 大类映射轨角色", () => {
    expect(roleFromProgram(0, 0)).toBe("keys");
    expect(roleFromProgram(24, 1)).toBe("guitar");
    expect(roleFromProgram(32, 2)).toBe("bass");
    expect(roleFromProgram(48, 3)).toBe("strings");
    expect(roleFromProgram(41, 3)).toBe("strings");
    expect(roleFromProgram(61, 4)).toBe("brass");
    expect(roleFromProgram(73, 5)).toBe("woodwind");
    expect(roleFromProgram(89, 6)).toBe("pad");
    expect(roleFromProgram(0, 9)).toBe("drums");
  });

  it("默认 program 覆盖新增大类", () => {
    expect(DEFAULT_PROGRAM.strings).toBe(48);
    expect(DEFAULT_PROGRAM.brass).toBe(61);
    expect(DEFAULT_PROGRAM.woodwind).toBe(73);
    expect(DEFAULT_PROGRAM.pad).toBe(89);
  });
});
