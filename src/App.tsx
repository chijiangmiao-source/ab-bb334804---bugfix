import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_DRAFT, parseDraft, type DraftState } from "./core/parse";
import type { ProblemInput, SolveResult, SolveSolution, ReachSets } from "./core/types";
import type { WorkerRequest, WorkerResponse } from "./worker/protocol";
import { TraceChart } from "./components/TraceChart";

type FeasibleSolve = SolveResult & { feasible: true; solution: SolveSolution; reach: ReachSets };

type RunState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: SolveResult }
  | { status: "error"; message: string };

const FIELD_LABELS: Record<string, string> = {
  samples: "整数电流样本",
  sampleCount: "样本数量",
  symbols: "有序符号",
  symbolCount: "符号数量",
  levels: "目标电平",
  minDwell: "驻留下限",
  maxDwell: "驻留上限",
  dwellRange: "驻留范围",
  maxCompensation: "最大补偿 D",
};

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  invalid?: boolean;
  error?: string;
  children: React.ReactNode;
}

function Field({ id, label, hint, invalid, error, children }: FieldProps) {
  return (
    <div className={`field ${invalid ? "invalid" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? <div className="error-msg">{error}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

function fmtSet(set: number[]): string {
  if (set.length === 0) return "—";
  if (set.length <= 24) return set.join(", ");
  return `${set.slice(0, 24).join(", ")} …（共 ${set.length} 个）`;
}

export function App() {
  const [draft, setDraft] = useState<DraftState>(DEFAULT_DRAFT);
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const [health, setHealth] = useState<"checking" | "ok" | "bad">("checking");
  const workerRef = useRef<Worker | null>(null);
  const reqIdRef = useRef(0);
  const lastInputRef = useRef<string>("");

  const parsed = useMemo(() => parseDraft(draft), [draft]);
  const issues = parsed.issues;
  const firstField = issues[0]?.field;

  // 健康检查：静态服务器在 /healthz 返回 200
  useEffect(() => {
    let alive = true;
    const check = async (): Promise<void> => {
      try {
        const res = await fetch("/healthz", { cache: "no-store" });
        if (alive) setHealth(res.ok ? "ok" : "bad");
      } catch {
        if (alive) setHealth("bad");
      }
    };
    void check();
    const t = setInterval(() => void check(), 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // 定位首因：错误首次出现时聚焦对应输入框
  const firstCauseKey = issues.length > 0 ? `${issues[0]!.field}:${issues[0]!.index ?? ""}` : "";
  useEffect(() => {
    if (!firstField) return;
    const el = document.getElementById(`field-${firstField}`);
    if (el) {
      el.focus();
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [firstCauseKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Worker 生命周期
  useEffect(() => {
    const w = new Worker(new URL("./worker/solve.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = w;
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.id !== reqIdRef.current) return;
      setRun({ status: "done", result: msg.result });
      if (msg.result.feasible && msg.id === pendingKeyRef.current.id) {
        setLastFeasible({
          key: pendingKeyRef.current.key,
          input: pendingKeyRef.current.input,
          result: msg.result as FeasibleSolve,
        });
      }
    };
    w.onerror = () => setRun({ status: "error", message: "求解线程发生错误" });
    return () => w.terminate();
  }, []);

  const pendingKeyRef = useRef<{ id: number; key: string; input: ProblemInput }>({
    id: -1,
    key: "",
    input: null as unknown as ProblemInput,
  });
  const [lastFeasible, setLastFeasible] = useState<{
    key: string;
    input: ProblemInput;
    result: FeasibleSolve;
  } | null>(null);

  // 输入合法后防抖触发求解；非法或无解均不清空草稿，也保留上一次可行结果
  useEffect(() => {
    if (!parsed.input) return;
    const key = JSON.stringify(parsed.input);
    if (key === lastInputRef.current && run.status === "done") return;
    lastInputRef.current = key;
    const id = ++reqIdRef.current;
    pendingKeyRef.current = { id, key, input: parsed.input };
    setRun({ status: "running" });
    const timer = setTimeout(() => {
      const req: WorkerRequest = { type: "solve", id, input: parsed.input! };
      workerRef.current?.postMessage(req);
    }, 120);
    return () => clearTimeout(timer);
  }, [parsed]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (patch: Partial<DraftState>): void => setDraft((d) => ({ ...d, ...patch }));
  const errFor = (field: string): string | undefined =>
    issues.find((i) => i.field === field)?.message;

  const result = run.status === "done" ? run.result : null;
  const currentKey = parsed.input ? JSON.stringify(parsed.input) : "";
  const snap = lastFeasible;
  const snapStale =
    snap !== null && (issues.length > 0 || (currentKey !== "" && snap.key !== currentKey));
  const solving = run.status === "running" && issues.length === 0;

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>纳米孔分段校准复核台</h1>
          <div className="sub">
            驻留长度 × 基线漂移两级优化：先最小化总绝对误差，再最小化补偿变化总量，末按交错向量取字典序规范解
          </div>
        </div>
        <div
          className={`health ${health === "ok" ? "ok" : health === "bad" ? "bad" : ""}`}
          title="GET /healthz"
        >
          {health === "ok" ? "● /healthz 正常" : health === "checking" ? "○ 健康检查中…" : "● /healthz 不可达"}
        </div>
      </header>

      <div className="layout">
        {/* ---------------- 左：录入 ---------------- */}
        <section className="panel">
          <h2>参数录入（草稿始终保留）</h2>

          {issues.length > 0 && (
            <div className="alert error">
              <div>
                共 {issues.length} 项问题，<span className="first">首因：{FIELD_LABELS[issues[0]!.field]}</span>
                {" — "}
                {issues[0]!.message}
              </div>
              {issues.length > 1 && (
                <ul>
                  {issues.slice(1, 6).map((it, k) => (
                    <li key={k}>{it.message}</li>
                  ))}
                  {issues.length > 6 ? <li>另有 {issues.length - 6} 项…</li> : null}
                </ul>
              )}
            </div>
          )}
          {result && !result.feasible && (
            <div className="alert warn">
              <div className="first">{result.infeasibleReason}</div>
              <div className="muted" style={{ marginTop: 4 }}>
                草稿已保留，调整驻留范围或样本后自动重新求解。
              </div>
            </div>
          )}

          <Field
            id="field-samples"
            label={`整数电流样本（6–600，空白/逗号/分号分隔；当前 ${
              draft.samplesText.trim() ? draft.samplesText.trim().split(/[\s,;]+/).length : 0
            } 个）`}
            invalid={firstField === "samples" || firstField === "sampleCount"}
            error={errFor("samples") ?? errFor("sampleCount")}
            hint="例：10 12 11 40 42 …"
          >
            <textarea
              id="field-samples"
              rows={3}
              value={draft.samplesText}
              onChange={(e) => update({ samplesText: e.target.value })}
            />
          </Field>

          <Field
            id="field-symbols"
            label="有序唯一符号（3–80）"
            invalid={firstField === "symbols" || firstField === "symbolCount"}
            error={errFor("symbols") ?? errFor("symbolCount")}
          >
            <textarea
              id="field-symbols"
              rows={1}
              value={draft.symbolsText}
              onChange={(e) => update({ symbolsText: e.target.value })}
            />
          </Field>

          <Field
            id="field-levels"
            label="目标电平（与符号同序的整数，每符号一个）"
            invalid={firstField === "levels"}
            error={errFor("levels")}
          >
            <textarea
              id="field-levels"
              rows={1}
              value={draft.levelsText}
              onChange={(e) => update({ levelsText: e.target.value })}
            />
          </Field>

          <div className="row3">
            <Field
              id="field-minDwell"
              label="驻留下限"
              invalid={firstField === "minDwell" || firstField === "dwellRange"}
              error={errFor("minDwell") ?? (firstField === "dwellRange" ? errFor("dwellRange") : undefined)}
            >
              <input
                id="field-minDwell"
                inputMode="numeric"
                value={draft.minDwellText}
                onChange={(e) => update({ minDwellText: e.target.value })}
              />
            </Field>
            <Field
              id="field-maxDwell"
              label="驻留上限"
              invalid={firstField === "maxDwell" || firstField === "dwellRange"}
              error={errFor("maxDwell") ?? (firstField === "dwellRange" ? errFor("dwellRange") : undefined)}
            >
              <input
                id="field-maxDwell"
                inputMode="numeric"
                value={draft.maxDwellText}
                onChange={(e) => update({ maxDwellText: e.target.value })}
              />
            </Field>
            <Field
              id="field-maxCompensation"
              label="最大补偿 D（0–8）"
              invalid={firstField === "maxCompensation"}
              error={errFor("maxCompensation")}
            >
              <input
                id="field-maxCompensation"
                inputMode="numeric"
                value={draft.maxCompText}
                onChange={(e) => update({ maxCompText: e.target.value })}
              />
            </Field>
          </div>

          <div className="muted">
            约束：每个符号的补偿 c∈[-D,D] 为整数；c₀ 固定为 0；|cᵢ-cᵢ₋₁|≤1；段内误差按
            <span className="mono"> |样本-(目标电平+补偿)| </span>
            求和。
          </div>
        </section>

        {/* ---------------- 右：结果 ---------------- */}
        <section className={`panel ${solving ? "stale" : ""}`}>
          <h2>
            复核结果
            {solving && <span className="badge live"><span className="spinner" /> 求解中…</span>}
            {!solving && snap && !snapStale && <span className="badge live">已联动更新</span>}
            {snapStale && <span className="badge">展示上一次可行结果（草稿已变更）</span>}
          </h2>

          {issues.length === 0 && solving && !snap && <div className="muted">正在求解…</div>}
          {run.status === "error" && <div className="alert error">{run.message}</div>}
          {issues.length > 0 && !snap && (
            <div className="muted">输入合法后自动求解；草稿不会被清空。</div>
          )}

          {snap && <ResultsBody input={snap.input} result={snap.result} />}
        </section>
      </div>
    </div>
  );
}

function ResultsBody({ input, result }: { input: ProblemInput; result: SolveResult & { feasible: true } }) {
  const sol = result.solution!;
  const reach = result.reach!;
  const K = input.symbols.length;

  // 交错向量 (e0,c1,e1,c2,...,e_{K-2},c_{K-1})
  const interleaved: { kind: "e" | "c"; value: number; label: string }[] = [];
  for (let i = 0; i < K - 1; i++) {
    interleaved.push({ kind: "e", value: sol.ends[i], label: `e${i}` });
    interleaved.push({ kind: "c", value: sol.comps[i + 1], label: `c${i + 1}` });
  }

  return (
    <div className="tables-wrap">
      <div className="stat-grid">
        <div className="stat">
          <div className="k">最小总绝对误差 E*</div>
          <div className="v">{sol.totalError}</div>
        </div>
        <div className="stat">
          <div className="k">最小补偿变化总量 V*</div>
          <div className="v">{sol.totalVariation}</div>
        </div>
        <div className="stat">
          <div className="k">前两级同优方案总数</div>
          <div className="v">{reach.optimalCount}</div>
        </div>
        <div className="stat">
          <div className="k">样本 / 符号数</div>
          <div className="v">
            {input.samples.length} / {K}
          </div>
        </div>
      </div>

      <TraceChart input={input} result={result} />

      <div>
        <div className="section-title">字典序规范解的交错向量（结束下标 × 补偿）</div>
        <div className="vector">
          <span className="muted">(</span>
          {interleaved.map((item, k) => (
            <span key={k} className="chip-wrap">
              <span className={`chip ${item.kind === "e" ? "boundary" : "comp"}`} title={item.label}>
                {item.label}={item.value}
              </span>
              {k < interleaved.length - 1 && <span className="muted">, </span>}
            </span>
          ))}
          <span className="muted">)</span>
        </div>
      </div>

      <div>
        <div className="section-title">规范路径（分段与补偿）</div>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>符号</th>
              <th>样本区间</th>
              <th>驻留</th>
              <th>目标电平</th>
              <th>规范补偿 c</th>
              <th>规范电平</th>
            </tr>
          </thead>
          <tbody>
            {input.symbols.map((sym, i) => (
              <tr key={i}>
                <td className="muted">{i}</td>
                <td>{sym}</td>
                <td className="mono">
                  [{sol.starts[i]}, {sol.ends[i]}]
                </td>
                <td>{sol.ends[i] - sol.starts[i] + 1}</td>
                <td className="mono">{input.levels[i]}</td>
                <td className="mono">{sol.comps[i]}</td>
                <td className="mono">{input.levels[i] + sol.comps[i]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <div className="section-title">前两级同优（E*、V* 均最优）方案的完整可达集合</div>
        <table>
          <thead>
            <tr>
              <th>边界 / 补偿</th>
              <th>规范取值</th>
              <th className="sets">同优可达全集</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: K - 1 }, (_, i) => (
              <tr key={`e-${i}`}>
                <td className="mono">
                  e{i} <span className="muted">({input.symbols[i]}|{input.symbols[i + 1]} 边界下标)</span>
                </td>
                <td className="mono">{sol.ends[i]}</td>
                <td className="sets">
                  {fmtSet(reach.boundarySets[i])}
                  <span className="muted">（{reach.boundarySets[i].length} 个）</span>
                </td>
              </tr>
            ))}
            {input.symbols.map((sym, i) => (
              <tr key={`c-${i}`}>
                <td className="mono">
                  c{i} <span className="muted">({sym} 的补偿{i === 0 ? "，固定 0" : ""})</span>
                </td>
                <td className="mono">{sol.comps[i]}</td>
                <td className="sets">
                  {fmtSet(reach.compSets[i])}
                  <span className="muted">（{reach.compSets[i].length} 个）</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="muted" style={{ marginTop: 6 }}>
          末段边界 e{K - 1} 恒为 {input.samples.length - 1}（最后一个样本下标），不属于可选内部边界。
        </div>
      </div>
    </div>
  );
}
