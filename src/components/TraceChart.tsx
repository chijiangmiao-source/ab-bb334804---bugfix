import { useMemo } from "react";
import type { ProblemInput, SolveResult } from "../core/types";

interface Props {
  input: ProblemInput;
  result: SolveResult;
}

const PALETTE = [
  "#5b9dff",
  "#37c46e",
  "#f2b134",
  "#f05d6a",
  "#8e7bff",
  "#2ec4c4",
  "#e879f9",
  "#fb923c",
];

/** 电流轨迹复核图：样本折线、规范电平段（目标+补偿）、同优可达边界与补偿 */
export function TraceChart({ input, result }: Props) {
  const W = 1000;
  const H = 300;
  const ML = 48;
  const MR = 14;
  const MT = 14;
  const MB = 34;
  const iw = W - ML - MR;
  const ih = H - MT - MB;

  const model = useMemo(() => {
    const { samples, levels } = input;
    const sol = result.solution!;
    const reach = result.reach!;
    const N = samples.length;

    const ys: number[] = [...samples];
    levels.forEach((lv, i) => {
      for (const c of reach.compSets[i]) ys.push(lv + c);
      ys.push(lv + sol.comps[i]);
    });
    let yMin = Math.min(...ys);
    let yMax = Math.max(...ys);
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }
    const pad = (yMax - yMin) * 0.08;
    yMin -= pad;
    yMax += pad;

    const x = (t: number): number => ML + (N === 1 ? iw / 2 : (t / (N - 1)) * iw);
    const y = (v: number): number => MT + ih - ((v - yMin) / (yMax - yMin)) * ih;

    const points = samples.map((v, t) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

    // y 轴刻度
    const ticks: number[] = [];
    const steps = 5;
    for (let k = 0; k <= steps; k++) ticks.push(yMin + ((yMax - yMin) * k) / steps);

    // x 轴刻度（样本稀疏标注）
    const xTickCount = Math.min(N, 12);
    const xTicks: number[] = [];
    for (let k = 0; k < xTickCount; k++) xTicks.push(Math.round((k * (N - 1)) / (xTickCount - 1)));

    return { x, y, points, ticks, xTicks, yMin, yMax };
  }, [input, result]);

  if (!result.feasible || !result.solution) return null;
  const { samples, levels, symbols } = input;
  const sol = result.solution;
  const reach = result.reach!;
  const { x, y, points, ticks, xTicks } = model;

  const segColor = (i: number): string => PALETTE[i % PALETTE.length];
  const showSegLabels = symbols.length <= 24;

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="电流轨迹分段复核图">
        {/* 网格与 y 轴刻度 */}
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={ML} x2={W - MR} y1={y(v)} y2={y(v)} stroke="#2b3550" strokeWidth={1} />
            <text x={ML - 6} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill="#98a3bd">
              {Math.round(v)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={x(t)} y={H - 12} textAnchor="middle" fontSize={10} fill="#98a3bd">
            {t}
          </text>
        ))}
        <line x1={ML} x2={ML} y1={MT} y2={H - MB} stroke="#2b3550" />
        <line x1={ML} x2={W - MR} y1={H - MB} y2={H - MB} stroke="#2b3550" />

        {/* 同优可达补偿：各段淡色电平线 */}
        {symbols.map((_, i) =>
          (reach.compSets[i] ?? [])
            .filter((c) => c !== sol.comps[i])
            .map((c) => (
              <line
                key={`rc-${i}-${c}`}
                x1={x(sol.starts[i])}
                x2={x(sol.ends[i])}
                y1={y(levels[i] + c)}
                y2={y(levels[i] + c)}
                stroke={segColor(i)}
                strokeOpacity={0.22}
                strokeWidth={2}
                strokeDasharray="2 3"
              />
            )),
        )}

        {/* 同优可达边界：轴上三角（位于样本间隙中点） */}
        {reach.boundarySets.map((set, i) =>
          i < symbols.length - 1
            ? set.map((e) => {
                const canonical = e === sol.ends[i];
                const xb = x(e) + (x(1) - x(0)) / 2;
                return (
                  <polygon
                    key={`rb-${i}-${e}`}
                    points={`${xb + 3},${H - MB - 1} ${xb - 3},${H - MB - 1} ${xb},${H - MB + 5}`}
                    fill={canonical ? segColor(i + 1) : "#8e7bff"}
                    fillOpacity={canonical ? 1 : 0.55}
                  />
                );
              })
            : null,
        )}

        {/* 规范电平段 */}
        {symbols.map((_, i) => {
          const level = levels[i] + sol.comps[i];
          return (
            <g key={`seg-${i}`}>
              <line
                x1={x(sol.starts[i])}
                x2={x(sol.ends[i])}
                y1={y(level)}
                y2={y(level)}
                stroke={segColor(i)}
                strokeWidth={3}
                strokeLinecap="round"
              />
              {showSegLabels && (
                <text
                  x={x(sol.starts[i]) + 4}
                  y={y(level) - 6}
                  fontSize={11}
                  fill={segColor(i)}
                  fontWeight={600}
                >
                  {symbols[i]}={level}
                </text>
              )}
            </g>
          );
        })}

        {/* 规范内部边界竖线 */}
        {sol.ends.slice(0, -1).map((e, i) => (
          <line
            key={`b-${i}`}
            x1={x(e) + (x(1) - x(0)) / 2}
            x2={x(e) + (x(1) - x(0)) / 2}
            y1={MT}
            y2={H - MB}
            stroke={segColor(i + 1)}
            strokeOpacity={0.55}
            strokeWidth={1.2}
            strokeDasharray="5 4"
          />
        ))}

        {/* 样本轨迹 */}
        <polyline points={points} fill="none" stroke="#cdd7ee" strokeWidth={1.4} strokeOpacity={0.9} />
        {samples.map((v, t) => (
          <circle key={t} cx={x(t)} cy={y(v)} r={samples.length > 200 ? 1.4 : 2} fill="#cdd7ee" />
        ))}
      </svg>
      <div className="legend">
        <span>
          <i style={{ background: "#cdd7ee" }} />
          样本电流
        </span>
        <span>
          <i style={{ background: "#5b9dff" }} />
          规范分段电平（目标 + 补偿）
        </span>
        <span>
          <i style={{ background: "#8e7bff" }} />
          同优可达边界（轴上三角）
        </span>
        <span>
          <i style={{ background: "#8e7bff", opacity: 0.5 }} />
          同优可达补偿电平（淡色虚线）
        </span>
      </div>
    </div>
  );
}
