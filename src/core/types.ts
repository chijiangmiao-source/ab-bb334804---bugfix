/**
 * 问题的规范化输入与求解结果类型定义。
 *
 * 问题：N 个整数电流样本，按 K 个有序唯一符号顺序分段，
 * 每段至少 Lmin 个样本、至多 Lmax 个；第 i 个符号目标电平为 level[i]，
 * 可在 [-D, D] 内选整数基线补偿 c[i]，c[0] 固定为 0，|c[i]-c[i-1]| <= 1。
 * 段内绝对误差按「目标电平 + 补偿」计算。
 *
 * 优化顺序：
 *   1. 总绝对误差最小；
 *   2. 补偿变化总量 Σ|c[i]-c[i-1]| 最小；
 *   3. 交错向量 (e_0, c_1, e_1, c_2, ..., e_{K-2}, c_{K-1})
 *      （结束下标与补偿交错）字典序最小；
 * 并输出在前两级同优方案下，每个边界 e_i 与每个补偿 c_i 的完整可达集合。
 */

export interface ProblemInput {
  /** N 个整数电流样本（6 <= N <= 600） */
  samples: number[];
  /** K 个有序唯一符号（3 <= K <= 80） */
  symbols: string[];
  /** 与符号一一对应的目标电平（整数） */
  levels: number[];
  /** 统一驻留下限（含），1 <= minDwell <= maxDwell */
  minDwell: number;
  /** 统一驻留上限（含） */
  maxDwell: number;
  /** 最大补偿 0 <= D <= 8 */
  maxCompensation: number;
}

export interface SolveSolution {
  /** 各段结束下标（样本数组下标，0-based），长度 K，单调递增，末值恒为 N-1 */
  ends: number[];
  /** 各符号补偿，长度 K，comp[0] = 0 */
  comps: number[];
  /** 分段起点下标（由 ends 推出），长度 K */
  starts: number[];
  /** 每段绝对误差之和（字符串承载任意精度整数） */
  totalError: string;
  /** 补偿变化总量 Σ|c[i]-c[i-1]| */
  totalVariation: number;
}

export interface ReachSets {
  /** 前两级同优方案中，每个内部边界 e_i（i = 0..K-2）可取的全部下标 */
  boundarySets: number[][];
  /** 前两级同优方案中，每个补偿 c_i（i = 0..K-1）可取的全部整数；c_0 恒为 [0] */
  compSets: number[][];
  /** 前两级同优方案总数（可能很大，以字符串给出） */
  optimalCount: string;
}

export interface SolveResult {
  feasible: boolean;
  /** 不可行原因（已规范化的输入下） */
  infeasibleReason?: string;
  solution?: SolveSolution;
  reach?: ReachSets;
}

/** 校验问题单条错误：field 标识首个出错字段，便于 UI 定位首因 */
export interface ValidationIssue {
  field:
    | "samples"
    | "sampleCount"
    | "symbols"
    | "symbolCount"
    | "levels"
    | "minDwell"
    | "maxDwell"
    | "dwellRange"
    | "maxCompensation";
  index?: number;
  message: string;
}

/** 草稿 -> 规范化输入的解析结果；issues[0] 即首因 */
export interface ParsedDraft {
  issues: ValidationIssue[];
  input?: ProblemInput;
}
