import { describe, expect, it } from "vitest";
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
});
