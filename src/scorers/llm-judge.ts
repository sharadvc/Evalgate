import type { Scorer, ScoreContext, ScorerSpec } from "../types.js";
import { clamp01, result } from "./util.js";

/** Tokenize into a lowercase word set for the deterministic mock judge. */
function wordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
}

/** Jaccard overlap between two texts, used by the deterministic mock judge. */
function overlap(a: string, b: string): number {
  const sa = wordSet(a);
  const sb = wordSet(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : inter / union;
}

/** Build the judge prompt sent to a real provider. */
export function buildJudgePrompt(criteria: string, output: string, expected?: string): string {
  return [
    "You are a strict evaluator. Score how well the RESPONSE satisfies the CRITERIA.",
    expected ? `REFERENCE (an ideal answer):\n${expected}` : "",
    `CRITERIA:\n${criteria}`,
    `RESPONSE:\n${output}`,
    'Reply with ONLY compact JSON: {"score": <number between 0 and 1>, "reason": "<short>"}',
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Parse a `{score, reason}` object out of a model's judge reply. */
export function parseJudgeReply(text: string): { score: number; reason: string } {
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const obj = JSON.parse(match[0]);
      const score = Number(obj.score);
      if (!Number.isNaN(score)) {
        return { score, reason: String(obj.reason ?? "judge returned a score") };
      }
    } catch {
      // fall through
    }
  }
  return { score: 0, reason: `could not parse judge reply: ${text.slice(0, 80)}` };
}

/**
 * LLM-as-judge scorer. Delegates the quality judgment to a model.
 *
 * With the deterministic `mock` provider it computes a reproducible overlap
 * score against the criteria/reference, so tests need no network. With a real
 * provider it sends a judge prompt and parses a JSON `{score, reason}` reply.
 *
 * Options:
 *  - `criteria`: the rubric text the response is judged against (required)
 *  - `expected`: optional reference answer (falls back to `case.expected`)
 *  - `threshold`: pass threshold in [0,1], default 0.7
 *  - `model`: optional judge model override
 */
export const llmJudgeScorer: Scorer = {
  type: "llm-judge",
  async score(spec: ScorerSpec, ctx: ScoreContext) {
    const criteria = (spec.criteria as string | undefined) ?? "";
    if (!criteria) {
      return result(spec, { score: 0, passed: false, reason: "no criteria provided" });
    }
    const expected = (spec.expected as string | undefined) ?? ctx.case.expected;
    const threshold = typeof spec.threshold === "number" ? spec.threshold : 0.7;

    let score: number;
    let reason: string;

    if (ctx.provider.name === "mock") {
      // Deterministic judge: blend overlap with the reference and the criteria.
      const refScore = expected ? overlap(ctx.output, expected) : 0;
      const critScore = overlap(ctx.output, criteria);
      score = expected ? 0.7 * refScore + 0.3 * critScore : critScore;
      reason = `mock judge overlap score ${score.toFixed(3)}`;
    } else {
      const reply = await ctx.provider.complete({
        model: (spec.model as string) || ctx.case.model || "",
        prompt: buildJudgePrompt(criteria, ctx.output, expected),
        temperature: 0,
      });
      const parsed = parseJudgeReply(reply.output);
      score = parsed.score;
      reason = parsed.reason;
    }

    if (score < 0 || score > 1) {
      return result(spec, {
        score: 0,
        passed: false,
        reason: `${reason} (judge score must be between 0 and 1)`,
      });
    }
    const clamped = clamp01(score);
    const passed = clamped >= threshold;
    return result(spec, { score: clamped, passed, reason });
  },
};
