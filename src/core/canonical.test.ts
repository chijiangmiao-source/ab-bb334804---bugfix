import { describe, expect, it } from "vitest";
import { solve } from "./solver";
import { bruteForce } from "./bruteforce";
import type { ProblemInput } from "./types";

/**
 * 同优分段边界回归：前两级目标（总绝对误差 E、补偿变化总量 V）完全相同时，
 * 规范裁决必须按交错向量 (e0,c1,e1,c2,...) 字典序唯一确定，且对全部
 * (E*,V*) 方案稳定，不允许只凭最终代价相等而保留扫描顺序上的任意路径。
 *
 * 业务输入（均在页面允许范围内）：
 *   样本 2, -4, -4, 0, 3, 1, -4；3 个符号，目标电平 -2, 0, 0；
 *   驻留 1..4；D = 2。
 * 存在两条 (E,V) 同优的完整方案：
 *   A 结束 [2,3,6] 补偿 [0,0,1]  —— 交错向量 (2,0,3,1)
 *   B 结束 [2,5,6] 补偿 [0,0,-1] —— 交错向量 (2,0,5,-1)
 * 两者 E=15、V=1；首个结束位置与首个补偿相同（2,0），
 * 后续更早的结束位置 3<5 必须使 A 成为规范解。
 */
const TIE_INPUT: ProblemInput = {
  samples: [2, -4, -4, 0, 3, 1, -4],
  symbols: ["s0", "s1", "s2"],
  levels: [-2, 0, 0],
  minDwell: 1,
  maxDwell: 4,
  maxCompensation: 2,
};

describe("前两级同优时的规范裁决（CANONICAL_OK）", () => {
  it("两级目标值不变：E*=15、V*=1", () => {
    const r = solve(TIE_INPUT);
    expect(r.feasible).toBe(true);
    const s = r.solution!;
    expect(s.totalError).toBe("15");
    expect(s.totalVariation).toBe(1);

    // 手工按规范路径重算，确认两级目标值
    let err = 0;
    let variation = 0;
    for (let i = 0; i < s.ends.length; i++) {
      const target = TIE_INPUT.levels[i] + s.comps[i];
      for (let t = s.starts[i]; t <= s.ends[i]; t++) err += Math.abs(TIE_INPUT.samples[t] - target);
      if (i > 0) variation += Math.abs(s.comps[i] - s.comps[i - 1]);
    }
    expect(BigInt(err).toString()).toBe("15");
    expect(variation).toBe(1);
  });

  it("完整规范路径为 ends=[2,3,6]、comps=[0,0,1]（而非 [2,5,6]/[0,0,-1]）", () => {
    const r = solve(TIE_INPUT);
    const s = r.solution!;
    // 完整路径逐段核对，不只看最终代价
    expect(s.ends).toEqual([2, 3, 6]);
    expect(s.comps).toEqual([0, 0, 1]);
    expect(s.starts).toEqual([0, 3, 4]);
    // 交错向量：(e0,c1,e1,c2)
    const interleave = [s.ends[0], s.comps[1], s.ends[1], s.comps[2]];
    expect(interleave).toEqual([2, 0, 3, 1]);

    // 被淘汰路径的两级目标必须确实同优（否则本场景不构成同优裁决）
    const rival = { ends: [2, 5, 6], comps: [0, 0, -1] };
    let rivalErr = 0;
    let rivalVar = 0;
    const rivalStarts = [0, rival.ends[0] + 1, rival.ends[1] + 1];
    for (let i = 0; i < 3; i++) {
      const target = TIE_INPUT.levels[i] + rival.comps[i];
      for (let t = rivalStarts[i]; t <= rival.ends[i]; t++) {
        rivalErr += Math.abs(TIE_INPUT.samples[t] - target);
      }
      if (i > 0) rivalVar += Math.abs(rival.comps[i] - rival.comps[i - 1]);
    }
    expect(rivalErr).toBe(15);
    expect(rivalVar).toBe(1);
  });

  it("同优集合同时包含两条路径：边界 e1∈{3,5}、补偿 c2∈{-1,1}，总数 2", () => {
    const r = solve(TIE_INPUT);
    const reach = r.reach!;
    expect(reach.boundarySets).toEqual([[2], [3, 5], []]);
    expect(reach.compSets).toEqual([[0], [0], [-1, 1]]);
    expect(reach.optimalCount).toBe("2");
  });

  it("与穷举参照的规范解（排序后首个）逐字段一致", () => {
    const got = solve(TIE_INPUT);
    const ref = bruteForce(TIE_INPUT);
    expect(got.solution!.ends).toEqual(ref.solution!.ends);
    expect(got.solution!.comps).toEqual(ref.solution!.comps);
    expect(got.solution!.starts).toEqual(ref.solution!.starts);
    expect(got.solution!.totalError).toBe(ref.solution!.totalError);
    expect(got.solution!.totalVariation).toBe(ref.solution!.totalVariation);
    expect(got.reach).toEqual(ref.reach);
  });
});
