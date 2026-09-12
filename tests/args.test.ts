import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { numFlag, parseArgs, InvalidNumericFlagError } from "../src/cli/args.js";
import { cmdCompare } from "../src/cli/index.js";
import type { RunResult } from "../src/types.js";

function runResult(score: number): RunResult {
  return {
    version: "1",
    suite: "s",
    timestamp: "now",
    score,
    passed: true,
    total: 1,
    passedCount: 1,
    latencyMs: 0,
    costUsd: 0,
    cases: [
      {
        id: "c1",
        model: "mock",
        provider: "mock",
        output: "",
        latencyMs: 1,
        costUsd: 0,
        score,
        passed: true,
        scores: [],
      },
    ],
  };
}

describe("numFlag", () => {
  it("returns fallback when the flag is omitted", () => {
    const args = parseArgs([]);
    expect(numFlag(args, "tolerance", 0)).toBe(0);
  });

  it("parses a numeric flag value", () => {
    const args = parseArgs(["--tolerance", "0.05"]);
    expect(numFlag(args, "tolerance", 0)).toBe(0.05);
  });

  it("rejects non-numeric flag values", () => {
    const args = parseArgs(["--tolerance", "abc"]);
    expect(() => numFlag(args, "tolerance", 0)).toThrow(InvalidNumericFlagError);
  });
});

describe("cmdCompare invalid tolerance", () => {
  it("rejects a non-numeric --tolerance instead of silently using the default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "evalgate-"));
    const base = join(dir, "base.json");
    const head = join(dir, "head.json");
    await writeFile(base, JSON.stringify(runResult(1)));
    await writeFile(head, JSON.stringify(runResult(1)));

    await expect(
      cmdCompare({
        _: ["compare"],
        flags: { base, head, tolerance: "abc" },
      }),
    ).rejects.toThrow(/tolerance/i);

    await rm(dir, { recursive: true, force: true });
  });
});
