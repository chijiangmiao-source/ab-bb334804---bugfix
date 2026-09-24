/**
 * 草稿文本 -> 规范化输入的解析与校验。
 * 全部错误均收集，但 issues[0] 按固定优先级给出「首因」，供 UI 定位。
 */
import type { ParsedDraft, ProblemInput, ValidationIssue } from "./types";

export interface DraftState {
  /** 样本：空白/逗号/分号分隔的整数 */
  samplesText: string;
  /** 有序符号：空白/逗号/分号分隔，需唯一 */
  symbolsText: string;
  /** 目标电平：与符号同序、同数量的整数 */
  levelsText: string;
  minDwellText: string;
  maxDwellText: string;
  /** 最大补偿 D（0..8） */
  maxCompText: string;
}

export const DEFAULT_DRAFT: DraftState = {
  samplesText: "10 12 11 40 42 39 41 -5 -3 -4 10 11",
  symbolsText: "a b c",
  levelsText: "11 40 -4",
  minDwellText: "2",
  maxDwellText: "6",
  maxCompText: "2",
};

const TOKEN_RE = /[\s,;]+/;
const INT_RE = /^[+-]?\d+$/;

function tokenize(text: string): string[] {
  return text.trim().length === 0 ? [] : text.trim().split(TOKEN_RE);
}

/** 严格十进制整数解析；拒绝小数、科学计数法、空串 */
export function parseInteger(token: string): number | null {
  const t = token.trim();
  if (!INT_RE.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

function parseIntList(text: string): { values: number[]; badIndex: number | null } {
  const tokens = tokenize(text);
  const values: number[] = [];
  let badIndex: number | null = null;
  tokens.forEach((tok, i) => {
    const v = parseInteger(tok);
    if (v === null) {
      if (badIndex === null) badIndex = i;
      values.push(NaN);
    } else {
      values.push(v);
    }
  });
  return { values, badIndex };
}

export function parseDraft(draft: DraftState): ParsedDraft {
  const issues: ValidationIssue[] = [];

  // ---- 样本 ----
  const sampleTokens = tokenize(draft.samplesText);
  const samples = parseIntList(draft.samplesText);
  if (samples.badIndex !== null) {
    issues.push({
      field: "samples",
      index: samples.badIndex,
      message: `第 ${samples.badIndex + 1} 个样本「${sampleTokens[samples.badIndex]}」不是整数`,
    });
  } else if (sampleTokens.length < 6 || sampleTokens.length > 600) {
    issues.push({
      field: "sampleCount",
      message: `样本数量需在 6 至 600 之间，当前为 ${sampleTokens.length}`,
    });
  }

  // ---- 符号 ----
  const symbolTokens = tokenize(draft.symbolsText);
  if (symbolTokens.length < 3 || symbolTokens.length > 80) {
    issues.push({
      field: "symbolCount",
      message: `符号数量需在 3 至 80 之间，当前为 ${symbolTokens.length}`,
    });
  }
  const seen = new Map<string, number>();
  symbolTokens.forEach((s, i) => {
    const prev = seen.get(s);
    if (prev !== undefined) {
      issues.push({
        field: "symbols",
        index: i,
        message: `符号「${s}」重复（首次出现于第 ${prev + 1} 位），符号必须唯一`,
      });
    } else {
      seen.set(s, i);
    }
  });

  // ---- 目标电平 ----
  const levelTokens = tokenize(draft.levelsText);
  const levels = parseIntList(draft.levelsText);
  if (levels.badIndex !== null) {
    issues.push({
      field: "levels",
      index: levels.badIndex,
      message: `第 ${levels.badIndex + 1} 个目标电平「${levelTokens[levels.badIndex]}」不是整数`,
    });
  } else if (symbolTokens.length >= 3 && symbolTokens.length <= 80) {
    if (levels.values.length !== symbolTokens.length) {
      issues.push({
        field: "levels",
        message: `目标电平数量（${levels.values.length}）必须与符号数量（${symbolTokens.length}）一致`,
      });
    }
  }

  // ---- 驻留上下限 ----
  const minDwell = parseInteger(draft.minDwellText);
  const maxDwell = parseInteger(draft.maxDwellText);
  if (minDwell === null || minDwell < 1) {
    issues.push({ field: "minDwell", message: "驻留下限必须为不小于 1 的整数" });
  }
  if (maxDwell === null || maxDwell < 1) {
    issues.push({ field: "maxDwell", message: "驻留上限必须为不小于 1 的整数" });
  }
  if (minDwell !== null && maxDwell !== null && minDwell >= 1 && maxDwell >= 1 && minDwell > maxDwell) {
    issues.push({ field: "dwellRange", message: `驻留下限（${minDwell}）不能大于上限（${maxDwell}）` });
  }

  // ---- 最大补偿 D ----
  const maxComp = parseInteger(draft.maxCompText);
  if (maxComp === null || maxComp < 0 || maxComp > 8) {
    issues.push({ field: "maxCompensation", message: "最大补偿 D 必须为 0 至 8 的整数" });
  }

  if (issues.length > 0) {
    return { issues };
  }

  const input: ProblemInput = {
    samples: samples.values,
    symbols: symbolTokens,
    levels: levels.values,
    minDwell: minDwell as number,
    maxDwell: maxDwell as number,
    maxCompensation: maxComp as number,
  };
  return { issues: [], input };
}
