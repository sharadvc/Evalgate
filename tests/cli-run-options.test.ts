import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../src/cli/args.js";
import { runOptionsFrom, cmdBaseline } from "../src/cli/index.js";

describe("runOptionsFrom", () => {
  it("returns concurrency and tag filter from CLI flags", () => {
    const args = parseArgs(["suite.yaml", "--tags", "smoke,fast", "--concurrency", "4", "--degrade"]);
    const opts = runOptionsFrom(args);
    expect(opts.concurrency).toBe(4);
    expect(opts.filterTags).toEqual(["smoke", "fast"]);
  });
});

describe("cmdBaseline", () => {
  it("honors --tags when building a baseline", async () => {
    const dir = await mkdtemp(join(tmpdir(), "evalgate-baseline-"));
    const suitePath = join(dir, "suite.eval.yaml");
    const outPath = join(dir, "base.json");
    await writeFile(
      suitePath,
      `name: tagged
provider: mock
model: mock
cases:
  - id: smoke-case
    tags: [smoke]
    input: { prompt: "exactly: hi" }
    expected: "hi"
    scorers: [{ type: exact-match }]
  - id: other
    input: { prompt: "exactly: bye" }
    expected: "bye"
    scorers: [{ type: exact-match }]
`,
      "utf8",
    );

    await cmdBaseline({
      _: [suitePath],
      flags: { tags: "smoke", out: outPath },
    });

    const saved = JSON.parse(await readFile(outPath, "utf8")) as { total: number; cases: { id: string }[] };
    expect(saved.total).toBe(1);
    expect(saved.cases[0]!.id).toBe("smoke-case");

    await rm(dir, { recursive: true, force: true });
  });
});
