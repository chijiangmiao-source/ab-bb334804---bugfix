import type { ProblemInput, SolveResult } from "../core/types";

export type WorkerRequest = { type: "solve"; id: number; input: ProblemInput };
export type WorkerResponse = { type: "result"; id: number; result: SolveResult };
