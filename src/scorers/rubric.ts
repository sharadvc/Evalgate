import type { Scorer, ScoreContext, ScorerSpec } from "../types.js";
import { normalize, result } from "./util.js";

/** A single weighted rubric criterion. */
export interface RubricCriterion {
  /** Human description of what is being checked. */
  description: string;
  /** Points awarded when the criterion is satisfied. Default 1. */
  points?: number;
  /** All of these substrings must be present (case-insensitive). */
  allOf?: string[];
  /** At least one of these substrings must be present. */
  anyOf?: string[];
  /** None of these substrings may be present. */
  noneOf?: string[];
  /** A regex the output must match. */
  pattern?: string;
}

function criterionSatisfied(
  output: string,
  c: RubricCriterion,
): boolean | { invalidPattern: string } {
  const hay = normalize(output);
  if (c.allOf && !c.allOf.every((s) => hay.includes(normalize(s)))) return false;
  if (c.anyOf && !c.anyOf.some((s) => hay.includes(normalize(s)))) return false;
  if (c.noneOf && c.noneOf.some((s) => hay.includes(normalize(s)))) return false;
  if (c.pattern) {
    try {
      if (!new RegExp(c.pattern, "i").test(output)) return false;
    } catch (err) {
      return { invalidPattern: (err as Error).message };
    }
  }
  // A criterion with no checks is treated as satisfied (documentation only).
  return true;
}

/**
 * A weighted rubric scorer. Each criterion contributes its points when
 * satisfied; the score is earned points over total points.
 *
 * Options:
 *  - `criteria`: array of {@link RubricCriterion}
 *  - `threshold`: pass threshold in [0,1], default 1 (all points required)
 */
export const rubricScorer: Scorer = {
  type: "rubric",
  score(spec: ScorerSpec, ctx: ScoreContext) {
    const criteria = (spec.criteria as RubricCriterion[] | undefined) ?? [];
    if (criteria.length === 0) {
      return result(spec, { score: 0, passed: false, reason: "no rubric criteria provided" });
    }
    const threshold = typeof spec.threshold === "number" ? spec.threshold : 1;

    let earned = 0;
    let total = 0;
    const failed: string[] = [];
    for (const c of criteria) {
      const points = c.points ?? 1;
      total += points;
      const satisfied = criterionSatisfied(ctx.output, c);
      if (typeof satisfied === "object") {
        return result(spec, {
          score: 0,
          passed: false,
          reason: `invalid regex in criterion "${c.description}": ${satisfied.invalidPattern}`,
        });
      }
      if (satisfied) {
        earned += points;
      } else {
        failed.push(c.description);
      }
    }
    const score = total === 0 ? 0 : earned / total;
    const passed = score >= threshold;
    return result(spec, {
      score,
      passed,
      reason:
        failed.length === 0
          ? `all ${criteria.length} rubric criteria met (${earned}/${total} pts)`
          : `${earned}/${total} pts; failed: ${failed.join("; ")}`,
    });
  },
};
