/**
 * 两级优化求解器（纯函数，无任何 IO / 在线依赖）。
 *
 * 状态 (i, e, c)：第 i 段在样本下标 e 结束、补偿为 c 的最优前缀。
 *   - 一级键：总绝对误差（BigInt，防溢出）
 *   - 二级键：补偿变化总量
 *   - 三级键：交错向量 (e0,c1,e1,c2,...,e_{K-2},c_{K-1}) 字典序
 * 每个状态只保留一条最优路径（子段代价只依赖状态本身，支配关系成立）。
 *
 * 转移对 (e, c) 的父代 p 落在长度为驻留范围的滑动窗口内，
 * 用单调队列把每个 (c, cp) 组的窗口最小值降到均摊 O(1) 次比较；
 * 字典序比较经倍增祖先表在 O(log K) 完成。
 *
 * 同优集合：前两级达到 (E*, V*) 的完整方案上做
 *   - 反向可达 R_i[e][c]（键值表 + 二分区间存在性）
 *   - 正向 BigInt 路径计数
 */
import type { ProblemInput, ReachSets, SolveResult, SolveSolution } from "./types";

const LOG = 8; // 2^7 = 128 >= Kmax(80)

interface Stage {
  index: number;
  lo: number;
  hi: number;
  width: number;
  /** 状态下标 = (e - lo) * C + cidx */
  exists: Uint8Array;
  err: (bigint | null)[];
  tv: Int16Array;
  end: Int32Array;
  parentEnd: Int32Array;
  parentLocal: Int32Array;
  up: Int32Array[];
}

const absBI = (x: bigint): bigint => (x < 0n ? -x : x);

/** P[i][cidx][j] = 第 i 段电平在补偿 c 下，样本 [0, j) 的绝对误差前缀和 */
function buildPrefixes(input: ProblemInput): bigint[][][] {
  const { samples, levels, maxCompensation: D } = input;
  const K = levels.length;
  const N = samples.length;
  const C = 2 * D + 1;
  const a = samples.map(BigInt);
  const P: bigint[][][] = [];
  for (let i = 0; i < K; i++) {
    const base = BigInt(levels[i]);
    const rows: bigint[][] = [];
    for (let ci = 0; ci < C; ci++) {
      const target = base + BigInt(ci - D);
      const row = new Array<bigint>(N + 1);
      row[0] = 0n;
      for (let t = 0; t < N; t++) {
        row[t + 1] = row[t] + absBI(a[t] - target);
      }
      rows.push(row);
    }
    P.push(rows);
  }
  return P;
}

export function solve(input: ProblemInput): SolveResult {
  const { samples, levels, minDwell: L, maxDwell: U, maxCompensation: D } = input;
  const N = samples.length;
  const K = levels.length;
  const C = 2 * D + 1;

  if (K * L > N) {
    return {
      feasible: false,
      infeasibleReason: `无解：每段至少 ${L} 个样本，${K} 段至少需要 ${K * L} 个样本，但只有 ${N} 个`,
    };
  }
  if (K * U < N) {
    return {
      feasible: false,
      infeasibleReason: `无解：每段至多 ${U} 个样本，${K} 段至多容纳 ${K * U} 个样本，但共有 ${N} 个`,
    };
  }

  const P = buildPrefixes(input);

  // 每段结束下标可行窗口
  const lo: number[] = [];
  const hi: number[] = [];
  for (let i = 0; i < K; i++) {
    lo.push(Math.max((i + 1) * L - 1, N - 1 - (K - 1 - i) * U));
    hi.push(Math.min(N - 1 - (K - 1 - i) * L, (i + 1) * U - 1));
  }

  const stages: Stage[] = [];
  const mkStage = (i: number): Stage => {
    const width = hi[i] - lo[i] + 1;
    const size = width * C;
    const stage: Stage = {
      index: i,
      lo: lo[i],
      hi: hi[i],
      width,
      exists: new Uint8Array(size),
      err: new Array<bigint | null>(size).fill(null),
      tv: new Int16Array(size),
      end: new Int32Array(size),
      parentEnd: new Int32Array(size),
      parentLocal: new Int32Array(size),
      up: [],
    };
    stages[i] = stage;
    return stage;
  };

  // ---- Stage 0：补偿固定为 0（cidx = D） ----
  const s0 = mkStage(0);
  for (let e = lo[0]; e <= hi[0]; e++) {
    const idx = (e - lo[0]) * C + D;
    s0.exists[idx] = 1;
    s0.err[idx] = P[0][D][e + 1]; // 起点为 0，前缀下界 P[..][0] = 0
    s0.tv[idx] = 0;
    s0.end[idx] = e;
    s0.parentEnd[idx] = -1;
    s0.parentLocal[idx] = -1;
  }

  /** 同一层两个状态的交错向量字典序比较（向量相同返回 0） */
  const cmpVector = (depth0: number, x: number, y: number): number => {
    if (x === y) return 0;
    let a = x;
    let b = y;
    let depth = depth0;
    // 倍增上跳到二者仍不同的最浅层（至少停在第 1 层，以便比较 e_0）
    for (let k = LOG - 1; k >= 0; k--) {
      if ((1 << k) <= depth - 1) {
        const st = stages[depth];
        const aa = st.up[k][a];
        const bb = st.up[k][b];
        if (aa >= 0 && aa !== bb) {
          a = aa;
          b = bb;
          depth -= 1 << k;
        }
      }
    }
    // a、b 此刻是首个分歧所在的最浅层状态：先比追加的边界 e_{d-1}，再比补偿 c_d
    const st = stages[depth];
    const pe = st.parentEnd[a] - st.parentEnd[b];
    if (pe !== 0) return pe;
    return (a % C) - (b % C);
  };

  // ---- Stages 1..K-1 ----
  for (let i = 1; i < K; i++) {
    const prev = stages[i - 1];
    const cur = mkStage(i);

    for (let cidx = 0; cidx < C; cidx++) {
      const c = cidx - D;
      const row = P[i][cidx];

      // 每个可行父补偿一个单调队列（队列里放父结束下标 p）
      const cpidxs: number[] = [];
      for (let d = -1; d <= 1; d++) {
        const cp = c + d;
        if (cp >= -D && cp <= D) cpidxs.push(cp + D);
      }
      const deques = new Map<number, number[]>();
      for (const cpi of cpidxs) deques.set(cpi, []);

      const keyOf = (p: number, cpi: number): { v: bigint; tv: number; p: number } => {
        const pidx = (p - prev.lo) * C + cpi;
        return { v: (prev.err[pidx] as bigint) - row[p + 1], tv: prev.tv[pidx], p };
      };
      const cmpKey = (p1: number, p2: number, cpi: number): number => {
        const k1 = keyOf(p1, cpi);
        const k2 = keyOf(p2, cpi);
        if (k1.v < k2.v) return -1;
        if (k1.v > k2.v) return 1;
        if (k1.tv !== k2.tv) return k1.tv - k2.tv;
        const i1 = (p1 - prev.lo) * C + cpi;
        const i2 = (p2 - prev.lo) * C + cpi;
        const vec = cmpVector(i - 1, i1, i2);
        if (vec !== 0) return vec;
        return p1 - p2;
      };
      const push = (d: number[], p: number, cpi: number): void => {
        while (d.length > 0 && cmpKey(d[d.length - 1], p, cpi) >= 0) d.pop();
        d.push(p);
      };
      const insertRange = (d: number[], from: number, to: number, cpi: number): void => {
        for (let p = from; p <= to; p++) {
          const pidx = (p - prev.lo) * C + cpi;
          if (prev.exists[pidx]) push(d, p, cpi);
        }
      };

      for (let e = cur.lo; e <= cur.hi; e++) {
        const low = Math.max(e - U, prev.lo);
        const high = Math.min(e - L, prev.hi);
        if (e === cur.lo) {
          for (const cpi of cpidxs) insertRange(deques.get(cpi) as number[], low, high, cpi);
        } else {
          const add = e - L;
          if (add >= prev.lo && add <= prev.hi) {
            for (const cpi of cpidxs) {
              const pidx = (add - prev.lo) * C + cpi;
              if (prev.exists[pidx]) push(deques.get(cpi) as number[], add, cpi);
            }
          }
          for (const cpi of cpidxs) {
            const d = deques.get(cpi) as number[];
            while (d.length > 0 && d[0] < low) d.shift();
          }
        }

        // 合并三个父补偿组的队首：(误差, 变化量, 父向量, 父结束下标)
        let best: { p: number; cpi: number } | null = null;
        for (const cpi of cpidxs) {
          const d = deques.get(cpi) as number[];
          if (d.length === 0) continue;
          const p = d[0];
          if (best === null) {
            best = { p, cpi };
            continue;
          }
          const bi = (best.p - prev.lo) * C + best.cpi;
          const ni = (p - prev.lo) * C + cpi;
          const eBest = (prev.err[bi] as bigint) + row[e + 1] - row[best.p + 1];
          const eNew = (prev.err[ni] as bigint) + row[e + 1] - row[p + 1];
          if (eNew < eBest) {
            best = { p, cpi };
          } else if (eNew === eBest) {
            const tvBest = prev.tv[bi] + Math.abs(c - (best.cpi - D));
            const tvNew = prev.tv[ni] + Math.abs(c - (cpi - D));
            if (tvNew < tvBest) {
              best = { p, cpi };
            } else if (tvNew === tvBest) {
              const vec = cmpVector(i - 1, ni, bi);
              if (vec < 0 || (vec === 0 && p < best.p)) best = { p, cpi };
            }
          }
        }

        if (best !== null) {
          const idx = (e - cur.lo) * C + cidx;
          const pidx = (best.p - prev.lo) * C + best.cpi;
          cur.exists[idx] = 1;
          cur.err[idx] =
            (prev.err[pidx] as bigint) + row[e + 1] - row[best.p + 1];
          cur.tv[idx] = prev.tv[pidx] + Math.abs(c - (best.cpi - D));
          cur.end[idx] = e;
          cur.parentEnd[idx] = best.p;
          cur.parentLocal[idx] = pidx;
        }
      }
    }

    // 倍增祖先表
    const size = cur.exists.length;
    cur.up[0] = cur.parentLocal.slice();
    for (let k = 1; k < LOG; k++) {
      const arr = new Int32Array(size).fill(-1);
      if ((1 << k) <= i) {
        const half = 1 << (k - 1);
        const ref = stages[i - half].up[k - 1];
        const near = cur.up[k - 1];
        for (let s = 0; s < size; s++) {
          if (near[s] >= 0) arr[s] = ref[near[s]];
        }
      }
      cur.up[k] = arr;
    }
  }

  // ---- 末段必须结束于 N-1：取全局 (误差, 变化量, 交错向量) 最优 ----
  const last = stages[K - 1];
  const endE = N - 1;
  let bestIdx = -1;
  for (let cidx = 0; cidx < C; cidx++) {
    const idx = (endE - last.lo) * C + cidx;
    if (!last.exists[idx]) continue;
    if (bestIdx === -1) {
      bestIdx = idx;
      continue;
    }
    const a = last.err[idx] as bigint;
    const b = last.err[bestIdx] as bigint;
    if (a < b || (a === b && (last.tv[idx] < last.tv[bestIdx] || (last.tv[idx] === last.tv[bestIdx] && cmpVector(K - 1, idx, bestIdx) < 0)))) {
      bestIdx = idx;
    }
  }
  if (bestIdx === -1) {
    return { feasible: false, infeasibleReason: "无解：驻留窗口内不存在满足全部约束的完整分段" };
  }

  const E_STAR = last.err[bestIdx] as bigint;
  const V_STAR = last.tv[bestIdx];

  // ---- 还原字典序最优解 ----
  const ends = new Array<number>(K);
  const comps = new Array<number>(K);
  let depth = K - 1;
  let idx = bestIdx;
  while (depth >= 0) {
    const st = stages[depth];
    ends[depth] = st.end[idx];
    comps[depth] = (idx % C) - D;
    idx = st.parentLocal[idx];
    depth--;
  }
  const starts = ends.map((_e, i) => (i === 0 ? 0 : (ends[i - 1] as number) + 1));
  const solution: SolveSolution = {
    ends: [...ends],
    comps,
    starts,
    totalError: E_STAR.toString(),
    totalVariation: V_STAR,
  };

  // ---- 同优方案计数（正向）与可达集合（反向） ----
  // 边键值表：给定子段 i、子补偿 cidx、父补偿 cpi，
  // key=(父误差 - 前缀[p+1], 父tv) -> 按 p 升序的位置（及计数前缀和）
  interface EdgeMap {
    keys: Map<string, number[]>;
    cum: Map<string, bigint[]>;
  }
  const buildEdgeMap = (segI: number, cidx: number, withCounts: boolean, prevCnt: (bigint | null)[] | null): EdgeMap => {
    const prev = stages[segI - 1];
    const row = P[segI][cidx];
    const all: Map<number, { key: string; p: number; local: number }[]> = new Map();
    for (let cpi = 0; cpi < C; cpi++) {
      const list: { key: string; p: number; local: number }[] = [];
      for (let p = prev.lo; p <= prev.hi; p++) {
        const local = (p - prev.lo) * C + cpi;
        if (!prev.exists[local]) continue;
        const v = (prev.err[local] as bigint) - row[p + 1];
        list.push({ key: `${v.toString()}|${prev.tv[local]}`, p, local });
      }
      all.set(cpi, list);
    }
    const keys = new Map<string, number[]>();
    const cum = new Map<string, bigint[]>();
    for (const [cpi, list] of all) {
      for (const item of list) {
        const k = `${cpi}:${item.key}`;
        let arr = keys.get(k);
        if (!arr) {
          arr = [];
          keys.set(k, arr);
        }
        arr.push(item.p);
        if (withCounts && prevCnt) {
          let carr = cum.get(k);
          if (!carr) {
            carr = [0n];
            cum.set(k, carr);
          }
          const cv = prevCnt[item.local] ?? 0n;
          carr.push((carr[carr.length - 1] as bigint) + cv);
        }
      }
    }
    return { keys, cum };
  };

  const bisect = (arr: number[], target: number): number => {
    let l = 0;
    let r = arr.length;
    while (l < r) {
      const m = (l + r) >> 1;
      if ((arr[m] as number) <= target) l = m + 1;
      else r = m;
    }
    return l;
  };
  const rangeCount = (arr: number[], cum: bigint[] | undefined, from: number, to: number): bigint => {
    if (!arr || to < from) return 0n;
    const hiB = bisect(arr, to);
    const loB = bisect(arr, from - 1);
    if (hiB === loB) return 0n;
    if (!cum) return hiB > loB ? 1n : 0n;
    return (cum[hiB] as bigint) - (cum[loB] as bigint);
  };

  // 正向计数
  let prevCnt: (bigint | null)[] = Array.from(s0.exists, (v) => (v ? 1n : null));
  for (let i = 1; i < K; i++) {
    const cur = stages[i];
    const curCnt: (bigint | null)[] = new Array(cur.exists.length).fill(null);
    for (let cidx = 0; cidx < C; cidx++) {
      const em = buildEdgeMap(i, cidx, true, prevCnt);
      const row = P[i][cidx];
      for (let e = cur.lo; e <= cur.hi; e++) {
        const idx = (e - cur.lo) * C + cidx;
        if (!cur.exists[idx]) continue;
        const pFrom = Math.max(e - U, stages[i - 1].lo);
        const pTo = Math.min(e - L, stages[i - 1].hi);
        let total = 0n;
        const c = cidx - D;
        for (let d = -1; d <= 1; d++) {
          const cp = c + d;
          if (cp < -D || cp > D) continue;
          const cpi = cp + D;
          const v = (cur.err[idx] as bigint) - row[e + 1];
          const tv = cur.tv[idx] - Math.abs(c - cp);
          const k = `${cpi}:${v.toString()}|${tv}`;
          const carr = em.cum.get(k);
          total += rangeCount(em.keys.get(k) as number[], carr, pFrom, pTo);
        }
        curCnt[idx] = total;
      }
    }
    prevCnt = curCnt;
  }
  let optimalCount = 0n;
  for (let cidx = 0; cidx < C; cidx++) {
    const idx = (endE - last.lo) * C + cidx;
    if (last.exists[idx] && last.err[idx] === E_STAR && last.tv[idx] === V_STAR) {
      optimalCount += prevCnt[idx] ?? 0n;
    }
  }

  // 反向可达
  const boundarySets: number[][] = [];
  const compSets: number[][] = [];
  let childR = new Uint8Array(last.exists.length);
  {
    const comps0: number[] = [];
    for (let cidx = 0; cidx < C; cidx++) {
      const idx = (endE - last.lo) * C + cidx;
      if (last.exists[idx] && last.err[idx] === E_STAR && last.tv[idx] === V_STAR) {
        childR[idx] = 1;
        comps0.push(cidx - D);
      }
    }
    compSets[K - 1] = comps0.sort((a, b) => a - b);
  }

  for (let i = K - 2; i >= 0; i--) {
    const cur = stages[i];
    const child = stages[i + 1];
    const curR = new Uint8Array(cur.exists.length);
    const edgeMaps = new Map<number, EdgeMap>();

    for (let cidx = 0; cidx < C; cidx++) {
      if (!edgeMaps.has(cidx)) edgeMaps.set(cidx, buildEdgeMap(i + 1, cidx, false, null));
      const em = edgeMaps.get(cidx) as EdgeMap;
      const row = P[i + 1][cidx];
      const c = cidx - D;
      for (let e = child.lo; e <= child.hi; e++) {
        const childLocal = (e - child.lo) * C + cidx;
        if (!childR[childLocal]) continue;
        const pFrom = Math.max(e - U, cur.lo);
        const pTo = Math.min(e - L, cur.hi);
        if (pTo < pFrom) continue;
        const childErr = child.err[childLocal] as bigint;
        const childTv = child.tv[childLocal];
        for (let d = -1; d <= 1; d++) {
          const cp = c + d;
          if (cp < -D || cp > D) continue;
          const cpi = cp + D;
          // 父前缀键值由子状态自身的 (误差, 变化量) 决定
          const v = childErr - row[e + 1];
          const tv = childTv - Math.abs(c - cp);
          const k = `${cpi}:${v.toString()}|${tv}`;
          const arr = em.keys.get(k);
          if (!arr) continue;
          const hiB = bisect(arr, pTo);
          const loB = bisect(arr, pFrom - 1);
          for (let q = loB; q < hiB; q++) {
            const p = arr[q] as number;
            curR[(p - cur.lo) * C + cpi] = 1;
          }
        }
      }
    }

    const bset = new Set<number>();
    const cset = new Set<number>();
    for (let e = cur.lo; e <= cur.hi; e++) {
      for (let cidx = 0; cidx < C; cidx++) {
        const local = (e - cur.lo) * C + cidx;
        if (curR[local]) {
          bset.add(e);
          cset.add(cidx - D);
        }
      }
    }
    boundarySets[i] = [...bset].sort((a, b) => a - b);
    compSets[i] = [...cset].sort((a, b) => a - b);
    childR = curR;
  }
  // 最末层的边界不属于内部边界（e_{K-1} 恒为 N-1）
  boundarySets[K - 1] = [];

  const reach: ReachSets = {
    boundarySets,
    compSets,
    optimalCount: optimalCount.toString(),
  };
  return { feasible: true, solution, reach };
}
