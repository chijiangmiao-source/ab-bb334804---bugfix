import { describe, expect, it } from "vitest";
import { parseDraft, parseInteger, DEFAULT_DRAFT } from "./parse";
import { solve } from "./solver";
import { bruteForce } from "./bruteforce";
import type { ProblemInput } from "./types";

function makeInput(
  samples: number[],
  levels: number[],
  minDwell: number,
  maxDwell: number,
  D: number,
  K = levels.length,
): ProblemInput {
  return {
    samples,
    levels,
    minDwell,
    maxDwell,
    maxCompensation: D,
    symbols: Array.from({ length: K }, (_, i) => `s${i}`),
  };
}

describe("parseInteger", () => {
  it("接受带符号十进制整数，拒绝其他写法", () => {
    expect(parseInteger("12")).toBe(12);
    expect(parseInteger("-3")).toBe(-3);
    expect(parseInteger("+7")).toBe(7);
    expect(parseInteger("1.0")).toBeNull();
    expect(parseInteger("1e3")).toBeNull();
    expect(parseInteger("")).toBeNull();
    expect(parseInteger("  42 ")).toBe(42);
  });
});

describe("parseDraft 校验与首因", () => {
  it("默认草稿合法", () => {
    const r = parseDraft(DEFAULT_DRAFT);
    expect(r.issues).toEqual([]);
    expect(r.input).toBeDefined();
  });

  it("样本数量越界", () => {
    const r = parseDraft({ ...DEFAULT_DRAFT, samplesText: "1 2 3 4 5" });
    expect(r.issues[0].field).toBe("sampleCount");
    expect(r.input).toBeUndefined();
  });

  it("超过 600 个样本报错", () => {
    const text = Array.from({ length: 601 }, (_, i) => i % 50).join(" ");
    const r = parseDraft({ ...DEFAULT_DRAFT, samplesText: text });
    expect(r.issues.some((x) => x.field === "sampleCount")).toBe(true);
  });

  it("非整数样本定位到首个坏下标", () => {
    const r = parseDraft({ ...DEFAULT_DRAFT, samplesText: "1 2 3 4 5 x 7 8" });
    expect(r.issues[0].field).toBe("samples");
    expect(r.issues[0].index).toBe(5);
  });

  it("符号数量越界与重复", () => {
    expect(parseDraft({ ...DEFAULT_DRAFT, symbolsText: "a b", levelsText: "1 2" }).issues[0].field).toBe(
      "symbolCount",
    );
    const dup = parseDraft({ ...DEFAULT_DRAFT, symbolsText: "a b a", levelsText: "1 2 3" });
    expect(dup.issues[0].field).toBe("symbols"); // 数量 3 合法，首因即重复
    expect(dup.issues[0].index).toBe(2);
  });

  it("电平数量不一致", () => {
    const r = parseDraft({ ...DEFAULT_DRAFT, levelsText: "1 2" });
    expect(r.issues[0].field).toBe("levels");
  });

  it("驻留范围与 D 范围", () => {
    expect(parseDraft({ ...DEFAULT_DRAFT, minDwellText: "5", maxDwellText: "2" }).issues[0].field).toBe(
      "dwellRange",
    );
    expect(parseDraft({ ...DEFAULT_DRAFT, maxCompText: "9" }).issues[0].field).toBe("maxCompensation");
    expect(parseDraft({ ...DEFAULT_DRAFT, maxCompText: "-1" }).issues[0].field).toBe("maxCompensation");
  });

  it("分隔符（逗号/分号/空白）等价", () => {
    const r = parseDraft({
      ...DEFAULT_DRAFT,
      samplesText: "10, 12;11 40,42;39 41 -5,-3 -4 10,11",
      symbolsText: "a,b;c",
      levelsText: "11;40, -4",
    });
    expect(r.issues).toEqual([]);
  });
});

describe("solve 基本性质", () => {
  it("默认例：c0=0、相邻补偿差 ≤1、驻留约束成立", () => {
    const input = parseDraft(DEFAULT_DRAFT).input!;
    const r = solve(input);
    expect(r.feasible).toBe(true);
    const s = r.solution!;
    expect(s.comps[0]).toBe(0);
    for (let i = 1; i < s.comps.length; i++) {
      expect(Math.abs(s.comps[i] - s.comps[i - 1])).toBeLessThanOrEqual(1);
      expect(Math.abs(s.comps[i])).toBeLessThanOrEqual(input.maxCompensation);
      const len = s.ends[i] - s.ends[i - 1];
      expect(len).toBeGreaterThanOrEqual(input.minDwell);
      expect(len).toBeLessThanOrEqual(input.maxDwell);
    }
    expect(s.ends.at(-1)).toBe(input.samples.length - 1);
    // 手工核对总误差
    let err = 0;
    for (let i = 0; i < s.ends.length; i++) {
      const target = input.levels[i] + s.comps[i];
      for (let t = s.starts[i]; t <= s.ends[i]; t++) err += Math.abs(input.samples[t] - target);
    }
    expect(BigInt(err).toString()).toBe(s.totalError);
  });

  it("D=0 时所有补偿为 0，仅做分段", () => {
    const input = makeInput([1, 2, 2, 8, 9, 8, 5, 4], [2, 8, 4], 2, 4, 0);
    const r = solve(input);
    expect(r.feasible).toBe(true);
    expect(r.solution!.comps.every((c) => c === 0)).toBe(true);
    expect(r.reach!.compSets.every((set) => set.length === 1 && set[0] === 0)).toBe(true);
  });

  it("补偿能吸收益处：含漂移的两段阶梯", () => {
    // 电平 0 与 10，样本缓慢上漂；非零补偿应能降低误差
    const samples = [0, 1, 1, 10, 11, 12];
    const r0 = solve(makeInput(samples, [0, 10, 5], 1, 4, 0));
    const r2 = solve(makeInput(samples, [0, 10, 5], 1, 4, 2));
    expect(BigInt(r2.solution!.totalError)).toBeLessThan(BigInt(r0.solution!.totalError));
  });

  it("样本不足以容纳最短驻留 -> 无解，保留原因", () => {
    const r = solve(makeInput([1, 2, 3, 4, 5, 6], [1, 2, 3], 3, 10, 1));
    expect(r.feasible).toBe(false);
    expect(r.infeasibleReason).toContain("无解");
  });

  it("上限过小 -> 无解", () => {
    const r = solve(makeInput([1, 2, 3, 4, 5, 6, 7], [1, 2, 3], 1, 2, 1));
    expect(r.feasible).toBe(false);
  });
});

describe("solve 与穷举参照一致（随机小例）", () => {
  // 简单 LCG 保证可复现
  let seed = 123456789;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const cases: { N: number; K: number; D: number; L: number; U: number }[] = [
    { N: 6, K: 3, D: 1, L: 1, U: 4 },
    { N: 8, K: 3, D: 2, L: 2, U: 4 },
    { N: 10, K: 4, D: 1, L: 2, U: 3 },
    { N: 12, K: 3, D: 3, L: 2, U: 6 },
    { N: 9, K: 3, D: 0, L: 2, U: 5 },
    { N: 14, K: 5, D: 2, L: 1, U: 5 },
  ];

  for (const cfg of cases) {
    for (let trial = 0; trial < 12; trial++) {
      it(`N=${cfg.N} K=${cfg.K} D=${cfg.D} L=${cfg.L} U=${cfg.U} #${trial}`, () => {
        const levels = Array.from({ length: cfg.K }, () => Math.floor(rand() * 12) - 4);
        const samples = Array.from({ length: cfg.N }, () => {
          const base = levels[Math.floor(rand() * cfg.K)] + Math.floor(rand() * 5) - 2;
          return base;
        });
        const input = makeInput(samples, levels, cfg.L, cfg.U, cfg.D);
        const got = solve(input);
        const ref = bruteForce(input);
        expect(got.feasible).toBe(ref.feasible);
        if (!ref.feasible) return;
        const gs = got.solution!;
        const rs = ref.solution!;
        expect(gs.ends).toEqual(rs.ends);
        expect(gs.comps).toEqual(rs.comps);
        expect(gs.totalError).toBe(rs.totalError);
        expect(gs.totalVariation).toBe(rs.totalVariation);
        expect(got.reach!.boundarySets).toEqual(ref.reach!.boundarySets);
        expect(got.reach!.compSets).toEqual(ref.reach!.compSets);
        expect(got.reach!.optimalCount).toBe(ref.reach!.optimalCount);
      });
    }
  }

  it("全部方案唯一时各集合恰有一个元素", () => {
    // 噪声极小的强阶梯 + 紧驻留，通常唯一；与穷举对比即可
    const input = makeInput([0, 0, 0, 50, 50, 50, 100, 100, 100], [0, 50, 100], 3, 3, 1);
    const got = solve(input);
    const ref = bruteForce(input);
    expect(got.reach!.optimalCount).toBe("1");
    expect(got.reach!.optimalCount).toBe(ref.reach!.optimalCount);
    expect(got.solution!.ends).toEqual([2, 5, 8]);
  });
});

describe("规模与性能", () => {
  it("600 样本 / 80 符号 / D=8 在上限规模下可快速求解", () => {
    const N = 600;
    const K = 80;
    const levels = Array.from({ length: K }, (_, i) => (i % 3) * 20 - 20);
    const samples = Array.from({ length: N }, (_, t) => {
      const seg = Math.min(K - 1, Math.floor((t / N) * K));
      return levels[seg] + ((t * 7) % 5) - 2;
    });
    const input = makeInput(samples, levels, 1, 600, 8);
    const t0 = Date.now();
    const r = solve(input);
    const elapsed = Date.now() - t0;
    expect(r.feasible).toBe(true);
    expect(r.solution!.ends).toHaveLength(K);
    expect(r.reach!.boundarySets).toHaveLength(K);
    // 宽松上限，CI 环境也应满足
    expect(elapsed).toBeLessThan(30000);
  }, 40000);
});
