import { describe, it, expect } from "vitest";
import { parseSuite, validateSuite, SuiteValidationError } from "../src/suite.js";

describe("suite parsing", () => {
  it("parses a minimal YAML suite", () => {
    const yaml = `
name: demo
cases:
  - id: c1
    input:
      prompt: "hi"
    scorers:
      - type: exact-match
        expected: hi
`;
    const suite = parseSuite(yaml, "demo.yaml");
    expect(suite.name).toBe("demo");
    expect(suite.cases).toHaveLength(1);
    expect(suite.cases[0]!.scorers[0]!.type).toBe("exact-match");
  });

  it("parses JSON suites", () => {
    const json = JSON.stringify({
      name: "j",
      cases: [{ id: "a", input: { prompt: "x" }, scorers: [{ type: "regex", pattern: "x" }] }],
    });
    const suite = parseSuite(json, "s.json");
    expect(suite.cases[0]!.id).toBe("a");
  });

  it("parses suite and case sampling options", () => {
    const suite = parseSuite(`
name: sampling
temperature: 0.2
maxTokens: 512
cases:
  - id: creative
    temperature: 0.7
    maxTokens: 64
    input:
      prompt: write something
    scorers:
      - type: regex
        pattern: .+
`, "sampling.yaml");

    expect(suite.temperature).toBe(0.2);
    expect(suite.maxTokens).toBe(512);
    expect(suite.cases[0]!.temperature).toBe(0.7);
    expect(suite.cases[0]!.maxTokens).toBe(64);
  });

  it("rejects a suite without a name", () => {
    expect(() => validateSuite({ cases: [] })).toThrow(SuiteValidationError);
  });

  it("coerces string tags to a single-element array", () => {
    const suite = validateSuite({
      name: "d",
      cases: [
        {
          id: "arith",
          tags: "arith",
          input: { prompt: "2+2" },
          scorers: [{ type: "regex", pattern: "4" }],
        },
      ],
    });
    expect(suite.cases[0]!.tags).toEqual(["arith"]);
  });

  it("rejects duplicate case ids", () => {
    expect(() =>
      validateSuite({
        name: "d",
        cases: [
          { id: "x", input: { prompt: "a" }, scorers: [{ type: "regex" }] },
          { id: "x", input: { prompt: "b" }, scorers: [{ type: "regex" }] },
        ],
      }),
    ).toThrow(/duplicate case id/);
  });

  it("rejects a case with no scorers", () => {
    expect(() =>
      validateSuite({ name: "d", cases: [{ id: "x", input: { prompt: "a" }, scorers: [] }] }),
    ).toThrow(/at least one scorer/);
  });

  it("rejects an out-of-range threshold", () => {
    expect(() =>
      validateSuite({
        name: "d",
        threshold: 2,
        cases: [{ id: "x", input: { prompt: "a" }, scorers: [{ type: "regex" }] }],
      }),
    ).toThrow(/threshold/);
  });

  it.each([
    ["temperature", -0.1],
    ["temperature", Number.POSITIVE_INFINITY],
    ["maxTokens", 0],
    ["maxTokens", 1.5],
  ])("rejects invalid suite %s", (field, value) => {
    expect(() =>
      validateSuite({
        name: "d",
        [field]: value,
        cases: [{ id: "x", input: { prompt: "a" }, scorers: [{ type: "regex" }] }],
      }),
    ).toThrow(new RegExp(`suite\\.${field}`));
  });

  it.each([
    ["temperature", Number.NaN],
    ["maxTokens", -1],
  ])("rejects invalid case %s", (field, value) => {
    expect(() =>
      validateSuite({
        name: "d",
        cases: [
          {
            id: "x",
            [field]: value,
            input: { prompt: "a" },
            scorers: [{ type: "regex" }],
          },
        ],
      }),
    ).toThrow(new RegExp(`case "x"\\.${field}`));
  });
});
