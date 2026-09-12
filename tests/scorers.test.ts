import { describe, it, expect } from "vitest";
import type { EvalCase, ProviderResponse, ScoreContext, ScorerSpec } from "../src/types.js";
import { MockProvider } from "../src/providers/mock.js";
import { exactMatchScorer } from "../src/scorers/exact-match.js";
import { regexScorer } from "../src/scorers/regex.js";
import { containsScorer, notContainsScorer } from "../src/scorers/contains.js";
import { jsonSchemaScorer, validate } from "../src/scorers/json-schema.js";
import { embeddingSimilarityScorer, cosineSimilarity } from "../src/scorers/embedding-similarity.js";
import { llmJudgeScorer } from "../src/scorers/llm-judge.js";
import { latencyScorer } from "../src/scorers/latency.js";
import { costScorer } from "../src/scorers/cost.js";
import { rubricScorer } from "../src/scorers/rubric.js";

const provider = new MockProvider();

function ctx(output: string, over: Partial<ProviderResponse> = {}, caseOver: Partial<EvalCase> = {}): ScoreContext {
  const response: ProviderResponse = {
    output,
    latencyMs: 10,
    model: "mock",
    costUsd: 0.0001,
    usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
    ...over,
  };
  const c: EvalCase = {
    id: "t",
    input: { prompt: "p" },
    scorers: [],
    ...caseOver,
  };
  return { output, response, case: c, provider };
}

async function run(scorer: any, spec: ScorerSpec, c: ScoreContext) {
  return await scorer.score(spec, c);
}

describe("exact-match", () => {
  it("passes on identical text ignoring case and whitespace", async () => {
    const r = await run(exactMatchScorer, { type: "exact-match", expected: "Hello  World" }, ctx("hello world"));
    expect(r.passed).toBe(true);
    expect(r.score).toBe(1);
  });
  it("fails on different text", async () => {
    const r = await run(exactMatchScorer, { type: "exact-match", expected: "a" }, ctx("b"));
    expect(r.passed).toBe(false);
  });
  it("uses case.expected as fallback", async () => {
    const r = await run(exactMatchScorer, { type: "exact-match" }, ctx("yes", {}, { expected: "yes" }));
    expect(r.passed).toBe(true);
  });
});

describe("regex", () => {
  it("passes when pattern matches", async () => {
    const r = await run(regexScorer, { type: "regex", pattern: "^\\d{3}$" }, ctx("123"));
    expect(r.passed).toBe(true);
  });
  it("supports expectMatch=false", async () => {
    const r = await run(regexScorer, { type: "regex", pattern: "\\d", expectMatch: false }, ctx("abc"));
    expect(r.passed).toBe(true);
  });
  it("reports invalid regex", async () => {
    const r = await run(regexScorer, { type: "regex", pattern: "(" }, ctx("x"));
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/invalid regex/);
  });
});

describe("contains / not-contains", () => {
  it("gives partial credit when some substrings missing", async () => {
    const r = await run(containsScorer, { type: "contains", values: ["a", "b", "c"] }, ctx("a and b"));
    expect(r.passed).toBe(false);
    expect(r.score).toBeCloseTo(2 / 3);
  });
  it("not-contains fails when a banned word present", async () => {
    const r = await run(notContainsScorer, { type: "not-contains", values: ["secret"] }, ctx("the secret is out"));
    expect(r.passed).toBe(false);
  });
});

describe("json-schema", () => {
  it("validates a conforming object", async () => {
    const spec: ScorerSpec = {
      type: "json-schema",
      schema: { type: "object", required: ["n"], properties: { n: { type: "number", minimum: 0 } } },
    };
    const r = await run(jsonSchemaScorer, spec, ctx('{"n": 5}'));
    expect(r.passed).toBe(true);
  });
  it("fails on invalid JSON", async () => {
    const r = await run(jsonSchemaScorer, { type: "json-schema" }, ctx("{not json"));
    expect(r.passed).toBe(false);
  });
  it("validate() surfaces schema errors", () => {
    const errs = validate({ n: -1 }, { type: "object", properties: { n: { type: "number", minimum: 0 } } });
    expect(errs.length).toBe(1);
  });
  it("validate() enforces enum and additionalProperties", () => {
    const errs = validate(
      { color: "purple", extra: 1 },
      {
        type: "object",
        properties: { color: { enum: ["red", "blue"] } },
        additionalProperties: false,
      },
    );
    expect(errs.length).toBe(2);
  });
  it("returns a path-attributed failure for an invalid nested pattern", async () => {
    const r = await run(
      jsonSchemaScorer,
      {
        type: "json-schema",
        schema: {
          type: "object",
          properties: { account: { type: "string", pattern: "[0-9" } },
        },
      },
      ctx('{"account":"123"}'),
    );

    expect(r.passed).toBe(false);
    expect(r.score).toBe(0);
    expect(r.reason).toContain("$.account: invalid pattern [0-9");
    expect(r.reason).toMatch(/unterminated/i);
  });
  it("still reports a normal mismatch for a valid pattern", () => {
    expect(validate("abc", { type: "string", pattern: "^\\d+$" })).toEqual([
      "$: does not match pattern ^\\d+$",
    ]);
  });
});

describe("embedding-similarity", () => {
  it("scores identical text near 1", async () => {
    const r = await run(
      embeddingSimilarityScorer,
      { type: "embedding-similarity", expected: "the quick brown fox", threshold: 0.9 },
      ctx("the quick brown fox"),
    );
    expect(r.passed).toBe(true);
    expect(r.score).toBeGreaterThan(0.9);
  });
  it("cosineSimilarity of orthogonal vectors is 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });
});

describe("llm-judge (mock)", () => {
  it("scores high when output matches the reference", async () => {
    const r = await run(
      llmJudgeScorer,
      { type: "llm-judge", criteria: "should be correct", expected: "paris is the capital of france", threshold: 0.5 },
      ctx("paris is the capital of france"),
    );
    expect(r.passed).toBe(true);
  });
  it("fails without criteria", async () => {
    const r = await run(llmJudgeScorer, { type: "llm-judge" }, ctx("x"));
    expect(r.passed).toBe(false);
  });
});

describe("latency and cost budgets", () => {
  it("latency passes within budget", async () => {
    const r = await run(latencyScorer, { type: "latency", budgetMs: 100 }, ctx("x", { latencyMs: 50 }));
    expect(r.passed).toBe(true);
  });
  it("latency degrades over budget", async () => {
    const r = await run(latencyScorer, { type: "latency", budgetMs: 100 }, ctx("x", { latencyMs: 150 }));
    expect(r.passed).toBe(false);
    expect(r.score).toBeCloseTo(0.5);
  });
  it("cost fails over budget", async () => {
    const r = await run(costScorer, { type: "cost", budgetUsd: 0.00001 }, ctx("x", { costUsd: 0.001 }));
    expect(r.passed).toBe(false);
  });
});

describe("rubric", () => {
  it("awards weighted points and passes at threshold", async () => {
    const spec: ScorerSpec = {
      type: "rubric",
      threshold: 0.5,
      criteria: [
        { description: "greets", anyOf: ["hello"], points: 1 },
        { description: "signs off", anyOf: ["regards"], points: 1 },
      ],
    };
    const r = await run(rubricScorer, spec, ctx("hello there"));
    expect(r.score).toBeCloseTo(0.5);
    expect(r.passed).toBe(true);
  });
  it("returns a fail result for an invalid criterion pattern regex", async () => {
    const r = await run(
      rubricScorer,
      { type: "rubric", criteria: [{ description: "x", pattern: "([" }] },
      ctx("anything"),
    );
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/invalid regex/i);
  });
});

describe("exact-match trim:false preserves internal whitespace", () => {
  it("matches when internal spaces are identical", async () => {
    const r = await run(exactMatchScorer, { type: "exact-match", expected: "a  b", trim: false }, ctx("a  b"));
    expect(r.passed).toBe(true);
  });
  it("fails when internal whitespace differs", async () => {
    const r = await run(exactMatchScorer, { type: "exact-match", expected: "a  b", trim: false }, ctx("a b"));
    expect(r.passed).toBe(false);
  });
});
