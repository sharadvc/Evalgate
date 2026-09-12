import type { Scorer, ScoreContext, ScorerSpec } from "../types.js";
import { localEmbedding } from "../providers/mock.js";
import { parseThreshold, result } from "./util.js";

/** Cosine similarity between two equal-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Scores the semantic similarity between the output and an expected reference.
 *
 * If the active provider exposes an `embed()` method it is used; otherwise a
 * deterministic local embedding fallback is used so the scorer always works
 * offline. The raw cosine similarity (mapped from [-1,1] to [0,1]) is the score;
 * it passes when the score meets `threshold`.
 *
 * Options:
 *  - `expected`: the reference text (falls back to `case.expected`)
 *  - `threshold`: pass threshold in [0,1], default 0.8
 */
export const embeddingSimilarityScorer: Scorer = {
  type: "embedding-similarity",
  async score(spec: ScorerSpec, ctx: ScoreContext) {
    const expected = (spec.expected as string | undefined) ?? ctx.case.expected;
    if (expected === undefined) {
      return result(spec, { score: 0, passed: false, reason: "no expected reference provided" });
    }
    const threshold = parseThreshold(spec, 0.8);
    if (threshold === null) {
      return result(spec, {
        score: 0,
        passed: false,
        reason: "invalid threshold (must be a finite number in [0, 1])",
      });
    }

    const embed = ctx.provider.embed
      ? (t: string) => ctx.provider.embed!(t)
      : (t: string) => Promise.resolve(localEmbedding(t));

    const [outVec, expVec] = await Promise.all([embed(ctx.output), embed(expected)]);
    const cos = cosineSimilarity(outVec, expVec);
    // Map [-1, 1] -> [0, 1].
    const score = (cos + 1) / 2;
    const passed = score >= threshold;
    return result(spec, {
      score,
      passed,
      reason: `similarity ${score.toFixed(3)} vs threshold ${threshold}`,
    });
  },
};
