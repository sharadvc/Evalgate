import type { CaseResult, RunResult } from "./types.js";

/** The per-case comparison outcome. */
export type CaseChange = "regressed" | "improved" | "unchanged" | "added" | "removed";

/** Delta for a single case between baseline and candidate. */
export interface CaseDelta {
  id: string;
  change: CaseChange;
  /** Baseline score, or null when the case was added. */
  baseScore: number | null;
  /** Candidate score, or null when the case was removed. */
  headScore: number | null;
  /** headScore - baseScore, or 0 when one side is missing. */
  delta: number;
  /** Baseline pass state. */
  basePassed: boolean | null;
  /** Candidate pass state. */
  headPassed: boolean | null;
}

/** The full comparison between two runs. */
export interface CompareResult {
  /** Mean candidate score minus mean baseline score. */
  overallDelta: number;
  baseScore: number;
  headScore: number;
  /** The largest single-case regression (a non-positive number). */
  worstRegression: number;
  /** True when any regression exceeds the configured tolerance. */
  regressed: boolean;
  /** The tolerance used for the regression decision. */
  tolerance: number;
  regressions: CaseDelta[];
  improvements: CaseDelta[];
  cases: CaseDelta[];
}

/** Raised when compare options fail validation. */
export class CompareValidationError extends Error {
  constructor(message: string) {
    super(`[evalgate] invalid compare options: ${message}`);
    this.name = "CompareValidationError";
  }
}

/** Options for {@link compareRuns}. */
export interface CompareOptions {
  /**
   * How much a score may drop before it counts as a regression. A value of
   * 0.001 ignores floating-point noise while catching real drops. Default 0.
   */
  tolerance?: number;
  /**
   * When true (default), a case that flips from passing to failing is always a
   * regression even if its numeric score drop is within tolerance.
   */
  failOnPassFlip?: boolean;
}

function byId(cases: CaseResult[]): Map<string, CaseResult> {
  return new Map(cases.map((c) => [c.id, c]));
}

/**
 * Compare a candidate run against a baseline and compute per-case and overall
 * deltas. This is the core value of evalgate: it turns two result artifacts into
 * a regression verdict.
 */
export function compareRuns(
  baseline: RunResult,
  head: RunResult,
  options: CompareOptions = {},
): CompareResult {
  const tolerance = options.tolerance ?? 0;
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new CompareValidationError("tolerance must be a non-negative finite number");
  }
  const failOnPassFlip = options.failOnPassFlip !== false;

  const baseMap = byId(baseline.cases);
  const headMap = byId(head.cases);
  const ids = new Set<string>([...baseMap.keys(), ...headMap.keys()]);

  const cases: CaseDelta[] = [];
  for (const id of ids) {
    const b = baseMap.get(id);
    const h = headMap.get(id);
    const baseScore = b ? b.score : null;
    const headScore = h ? h.score : null;

    let change: CaseChange;
    let delta = 0;
    if (b && h) {
      delta = h.score - b.score;
      const passFlip = failOnPassFlip && b.passed && !h.passed;
      if (delta < -tolerance || passFlip) change = "regressed";
      else if (delta > tolerance) change = "improved";
      else change = "unchanged";
    } else if (!b && h) {
      change = "added";
    } else {
      change = "removed";
    }

    cases.push({
      id,
      change,
      baseScore,
      headScore,
      delta,
      basePassed: b ? b.passed : null,
      headPassed: h ? h.passed : null,
    });
  }

  cases.sort((a, b) => a.delta - b.delta);

  const regressions = cases.filter((c) => c.change === "regressed");
  const improvements = cases.filter((c) => c.change === "improved");
  const worstRegression = cases.reduce((min, c) => Math.min(min, c.delta), 0);

  return {
    overallDelta: head.score - baseline.score,
    baseScore: baseline.score,
    headScore: head.score,
    worstRegression,
    regressed: regressions.length > 0,
    tolerance,
    regressions,
    improvements,
    cases,
  };
}
