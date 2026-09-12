import type { Scorer, ScoreContext, ScorerSpec } from "../types.js";
import { normalize, result } from "./util.js";

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return [value];
  return [];
}

/**
 * Passes when the output contains all of the required substrings. The score is
 * the fraction of substrings found, so partial credit is possible.
 *
 * Options:
 *  - `value` / `values`: substring(s) that must be present
 *  - `caseSensitive`: default false
 */
export const containsScorer: Scorer = {
  type: "contains",
  score(spec: ScorerSpec, ctx: ScoreContext) {
    const needles = [...asList(spec.value), ...asList(spec.values)].filter((n) => n.length > 0);
    if (needles.length === 0) {
      return result(spec, { score: 0, passed: false, reason: "no value(s) provided" });
    }
    const caseSensitive = spec.caseSensitive === true;
    const hay = normalize(ctx.output, { caseSensitive });
    const missing = needles.filter((n) => !hay.includes(normalize(n, { caseSensitive })));
    const found = needles.length - missing.length;
    const passed = missing.length === 0;
    return result(spec, {
      score: found / needles.length,
      passed,
      reason: passed
        ? `all ${needles.length} substring(s) present`
        : `missing: ${missing.map((m) => `"${m}"`).join(", ")}`,
    });
  },
};

/**
 * The inverse of {@link containsScorer}: passes when NONE of the substrings are
 * present. Useful for banned words and safety checks.
 */
export const notContainsScorer: Scorer = {
  type: "not-contains",
  score(spec: ScorerSpec, ctx: ScoreContext) {
    const needles = [...asList(spec.value), ...asList(spec.values)].filter((n) => n.length > 0);
    if (needles.length === 0) {
      return result(spec, { score: 0, passed: false, reason: "no value(s) provided" });
    }
    const caseSensitive = spec.caseSensitive === true;
    const hay = normalize(ctx.output, { caseSensitive });
    const present = needles.filter((n) => hay.includes(normalize(n, { caseSensitive })));
    const passed = present.length === 0;
    return result(spec, {
      score: passed ? 1 : (needles.length - present.length) / needles.length,
      passed,
      reason: passed
        ? `none of the ${needles.length} banned substring(s) present`
        : `found banned: ${present.map((m) => `"${m}"`).join(", ")}`,
    });
  },
};
