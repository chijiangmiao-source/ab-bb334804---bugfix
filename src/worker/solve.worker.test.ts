import { describe, expect, it, vi } from "vitest";
import { parseDraft, DEFAULT_DRAFT } from "../core/parse";
import type { WorkerResponse } from "./protocol";

describe("solve.worker 接线", () => {
  it("收到 solve 请求后回传同协议结果", async () => {
    const responses: WorkerResponse[] = [];
    const stub = {
      onmessage: null as ((ev: MessageEvent) => void) | null,
      postMessage: (m: WorkerResponse): void => {
        responses.push(m);
      },
    };
    (globalThis as unknown as { self: unknown }).self = stub;

    await import("./solve.worker.ts");

    const input = parseDraft(DEFAULT_DRAFT).input!;
    stub.onmessage!({ data: { type: "solve", id: 42, input } } as MessageEvent);

    expect(responses).toHaveLength(1);
    expect(responses[0].type).toBe("result");
    expect(responses[0].id).toBe(42);
    expect(responses[0].result.feasible).toBe(true);
    expect(responses[0].result.solution!.comps[0]).toBe(0);
  });

  it("前两级同优时回传给页面高亮的是规范分段路径", async () => {
    const responses: WorkerResponse[] = [];
    const stub = {
      onmessage: null as ((ev: MessageEvent) => void) | null,
      postMessage: (m: WorkerResponse): void => {
        responses.push(m);
      },
    };
    vi.resetModules();
    (globalThis as unknown as { self: unknown }).self = stub;

    await import("./solve.worker.ts");

    // 与 src/core/canonical.test.ts 相同的同优业务输入
    const input = parseDraft({
      samplesText: "2, -4, -4, 0, 3, 1, -4",
      symbolsText: "a b c",
      levelsText: "-2 0 0",
      minDwellText: "1",
      maxDwellText: "4",
      maxCompText: "2",
    }).input!;

    stub.onmessage!({ data: { type: "solve", id: 7, input } } as MessageEvent);

    expect(responses).toHaveLength(1);
    const result = responses[0].result;
    expect(result.feasible).toBe(true);
    expect(result.solution!.totalError).toBe("15");
    expect(result.solution!.totalVariation).toBe(1);
    expect(result.solution!.ends).toEqual([2, 3, 6]);
    expect(result.solution!.comps).toEqual([0, 0, 1]);
    expect(result.reach!.optimalCount).toBe("2");
  });
});
