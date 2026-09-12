import { describe, it, expect } from "vitest";
import type { CaseResult, RunResult } from "../src/types.js";
import { compareRuns } from "../src/compare.js";

function caseResult(id: string, score: number, passed = score >= 1): CaseResult {
  return {
    id,
    model: "mock",
    provider: "mock",
    output: "",
    latencyMs: 1,
    costUsd: 0,
    score,
    passed,
    scores: [],
  };
}

function run(cases: CaseResult[]): RunResult {
  const total = cases.length;
  const score = total ? cases.reduce((s, c) => s + c.score, 0) / total : 0;
  return {
    version: "1",
    suite: "s",
    timestamp: "now",
    score,
    passed: cases.every((c) => c.passed),
    total,
    passedCount: cases.filter((c) => c.passed).length,
    latencyMs: 0,
    costUsd: 0,
    cases,
  };
}

describe("compareRuns", () => {
  it("detects a regressed case", () => {
    const base = run([caseResult("a", 1), caseResult("b", 1)]);
    const head = run([caseResult("a", 1), caseResult("b", 0.5)]);
    const cmp = compareRuns(base, head);
    expect(cmp.regressed).toBe(true);
    expect(cmp.regressions.map((r) => r.id)).toEqual(["b"]);
    expect(cmp.overallDelta).toBeCloseTo(-0.25);
    expect(cmp.worstRegression).toBeCloseTo(-0.5);
  });

  it("reports improvements without regressing", () => {
    const base = run([caseResult("a", 0.5, false)]);
    const head = run([caseResult("a", 1)]);
    const cmp = compareRuns(base, head);
    expect(cmp.regressed).toBe(false);
    expect(cmp.improvements.map((r) => r.id)).toEqual(["a"]);
  });

  it("honors tolerance to ignore noise", () => {
    const base = run([caseResult("a", 1, true)]);
    const head = run([caseResult("a", 0.999, true)]);
    expect(compareRuns(base, head, { tolerance: 0 }).regressed).toBe(true);
    expect(compareRuns(base, head, { tolerance: 0.01 }).regressed).toBe(false);
  });

  it("treats a pass->fail flip as a regression even within tolerance", () => {
    const base = run([caseResult("a", 0.9, true)]);
    const head = run([caseResult("a", 0.9, false)]);
    const cmp = compareRuns(base, head, { tolerance: 0.5 });
    expect(cmp.regressed).toBe(true);
  });

  it("labels added and removed cases", () => {
    const base = run([caseResult("a", 1)]);
    const head = run([caseResult("b", 1)]);
    const cmp = compareRuns(base, head);
    const changes = Object.fromEntries(cmp.cases.map((c) => [c.id, c.change]));
    expect(changes.a).toBe("removed");
    expect(changes.b).toBe("added");
  });

  it("rejects negative tolerance", () => {
    const base = run([caseResult("a", 1)]);
    const head = run([caseResult("a", 0.5)]);
    expect(() => compareRuns(base, head, { tolerance: -0.5 })).toThrow(/tolerance/);
  });

  it("rejects NaN tolerance", () => {
    const base = run([caseResult("a", 1)]);
    const head = run([caseResult("a", 0.5)]);
    expect(() => compareRuns(base, head, { tolerance: NaN })).toThrow(/tolerance/);
  });
});
