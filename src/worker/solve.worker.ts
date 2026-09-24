/// <reference lib="webworker" />
import { solve } from "../core/solver";
import type { WorkerRequest, WorkerResponse } from "./protocol";

self.onmessage = (ev: MessageEvent<WorkerRequest>): void => {
  const msg = ev.data;
  if (msg.type !== "solve") return;
  const result = solve(msg.input);
  const res: WorkerResponse = { type: "result", id: msg.id, result };
  (self as DedicatedWorkerGlobalScope).postMessage(res);
};
