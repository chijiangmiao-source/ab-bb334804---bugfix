/**
 * 穷举参照实现（仅供测试）：枚举全部合法 (边界, 补偿) 方案，
 * 按 误差 -> 变化量 -> 交错向量 排序，并统计前两级同优集合。
 */
import type { ProblemInput, SolveResult } from "./types";

interface Candidate {
  ends: number[];
  comps: number[];
  err: bigint;
  tv: number;
}

export function bruteForce(input: ProblemInput): SolveResult {
  const { samples, levels, minDwell: L, maxDwell: U, maxCompensation: D } = input;
  const N = samples.length;
  const K = levels.length;

  const segErr = (seg: number, a: number, b: number, c: number): bigint => {
    const target = levels[seg] + c;
    let s = 0;
    for (let t = a; t <= b; t++) s += Math.abs(samples[t] - target);
    return BigInt(s);
  };

  const candidates: Candidate[] = [];
  const starts = new Array<number>(K + 1);
  starts[0] = 0;
  const ends = new Array<number>(K);
  const comps = new Array<number>(K).fill(0);

  /** 枚举第 seg 段（其补偿 comps[seg] 已确定）的结束位置 */
  const drive = (seg: number, accErr: bigint, tv: number): void => {
    const a = starts[seg] as number;
    if (seg === K - 1) {
      const b = N - 1;
      const len = b - a + 1;
      if (len >= L && len <= U) {
        ends[seg] = b;
        candidates.push({
          ends: [...ends],
          comps: [...comps],
          err: accErr + segErr(seg, a, b, comps[seg] as number),
          tv,
        });
      }
      return;
    }
    const remainSegs = K - 1 - seg;
    for (let next = a + L; next <= a + U; next++) {
      if (next + remainSegs * L > N) break;
      if (next + remainSegs * U < N) continue;
      starts[seg + 1] = next;
      ends[seg] = next - 1;
      const errHere = accErr + segErr(seg, a, next - 1, comps[seg] as number);
      const prevC = comps[seg] as number;
      for (let c = -D; c <= D; c++) {
        if (Math.abs(c - prevC) > 1) continue;
        comps[seg + 1] = c || 0; // -0 归一为 0
        drive(seg + 1, errHere, tv + Math.abs(c - prevC));
      }
    }
  };
  drive(0, 0n, 0);

  if (candidates.length === 0) {
    return { feasible: false, infeasibleReason: "穷举无可行方案" };
  }

  const minErr = candidates.reduce((m, x) => (x.err < m ? x.err : m), candidates[0].err);
  const lvl1 = candidates.filter((x) => x.err === minErr);
  const minTv = Math.min(...lvl1.map((x) => x.tv));
  const lvl2 = lvl1.filter((x) => x.tv === minTv);

  const interleave = (x: Candidate): number[] => {
    const v: number[] = [];
    for (let i = 0; i < K - 1; i++) {
      v.push(x.ends[i] as number);
      v.push(x.comps[i + 1] as number);
    }
    return v;
  };
  const cmp = (a: number[], b: number[]): number => {
    for (let i = 0; i < a.length; i++) {
      if ((a[i] as number) !== (b[i] as number)) return (a[i] as number) - (b[i] as number);
    }
    return 0;
  };
  lvl2.sort((x, y) => cmp(interleave(x), interleave(y)));
  const best = lvl2[0] as Candidate;

  const boundarySets: number[][] = [];
  const compSets: number[][] = [];
  for (let i = 0; i < K - 1; i++) {
    boundarySets.push([...new Set(lvl2.map((x) => x.ends[i]))].sort((a, b) => a - b));
  }
  boundarySets.push([]);
  for (let i = 0; i < K; i++) {
    compSets.push([...new Set(lvl2.map((x) => x.comps[i]))].sort((a, b) => a - b));
  }

  const startsOut = best.ends.map((_, i) => (i === 0 ? 0 : (best.ends[i - 1] as number) + 1));
  return {
    feasible: true,
    solution: {
      ends: best.ends,
      comps: best.comps,
      starts: startsOut,
      totalError: best.err.toString(),
      totalVariation: best.tv,
    },
    reach: {
      boundarySets,
      compSets,
      optimalCount: BigInt(lvl2.length).toString(),
    },
  };
}
