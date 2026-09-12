#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { parseArgs, strFlag, boolFlag, numFlag, type ParsedArgs } from "./args.js";
import { loadSuite } from "../suite.js";
import { runSuite } from "../runner.js";
import { compareRuns } from "../compare.js";
import { renderRunTerminal, renderCompareTerminal } from "../reporters/terminal.js";
import { renderRunMarkdown, renderCompareMarkdown } from "../reporters/markdown.js";
import { renderRunJUnit } from "../reporters/junit.js";
import { defaultRegistry } from "../providers/registry.js";
import { defaultScorerRegistry } from "../scorers/registry.js";
import { MockProvider } from "../providers/mock.js";
import { contextFromEnv, upsertComment } from "../github.js";
import type { RunResult } from "../types.js";
import { CLI_HELP } from "./help.js";

const require = createRequire(import.meta.url);

function version(): string {
  try {
    return require("../../package.json").version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Build a provider registry, allowing a --degrade toggle for the mock. */
function registryFor(args: ParsedArgs) {
  const degrade = boolFlag(args, "degrade");
  const registry = defaultRegistry(process.env);
  if (degrade) registry.register("mock", () => new MockProvider({ degrade: true }));
  return registry;
}

async function writeArtifacts(args: ParsedArgs, run: RunResult): Promise<void> {
  const out = strFlag(args, "out");
  if (out) await writeFile(out, JSON.stringify(run, null, 2) + "\n", "utf8");
  const md = strFlag(args, "md");
  if (md) await writeFile(md, renderRunMarkdown(run) + "\n", "utf8");
  const junit = strFlag(args, "junit");
  if (junit) await writeFile(junit, renderRunJUnit(run) + "\n", "utf8");
}

async function cmdRun(args: ParsedArgs): Promise<number> {
  const suitePath = args._[0];
  if (!suitePath) throw new Error("run requires a suite path");
  const suite = await loadSuite(suitePath);
  const run = await runSuite(suite, {
    providers: registryFor(args),
    defaultProvider: strFlag(args, "provider"),
    defaultModel: strFlag(args, "model"),
    concurrency: numFlag(args, "concurrency", 1),
    filterTags: strFlag(args, "tags")?.split(",").map((s) => s.trim()).filter(Boolean),
  });

  if (boolFlag(args, "json")) console.log(JSON.stringify(run, null, 2));
  else console.log(renderRunTerminal(run));
  await writeArtifacts(args, run);

  return run.passed || boolFlag(args, "no-fail") ? 0 : 1;
}

async function cmdBaseline(args: ParsedArgs): Promise<number> {
  const suitePath = args._[0];
  if (!suitePath) throw new Error("baseline requires a suite path");
  const out = strFlag(args, "out") ?? "evalgate.baseline.json";
  const suite = await loadSuite(suitePath);
  const run = await runSuite(suite, {
    providers: registryFor(args),
    defaultProvider: strFlag(args, "provider"),
    defaultModel: strFlag(args, "model"),
  });
  await writeFile(out, JSON.stringify(run, null, 2) + "\n", "utf8");
  console.log(`Saved baseline for "${run.suite}" -> ${out} (mean score ${(run.score * 100).toFixed(1)}%)`);
  return 0;
}

async function loadResult(path: string): Promise<RunResult> {
  return JSON.parse(await readFile(path, "utf8")) as RunResult;
}

export async function cmdCompare(args: ParsedArgs): Promise<number> {
  const basePath = strFlag(args, "base");
  if (!basePath) throw new Error("compare requires --base <baseline.json>");
  const baseline = await loadResult(basePath);

  let head: RunResult;
  const headPath = strFlag(args, "head");
  const suitePath = args._[0];
  if (headPath) {
    head = await loadResult(headPath);
  } else if (suitePath) {
    const suite = await loadSuite(suitePath);
    head = await runSuite(suite, {
      providers: registryFor(args),
      defaultProvider: strFlag(args, "provider"),
      defaultModel: strFlag(args, "model"),
    });
    const out = strFlag(args, "out");
    if (out) await writeFile(out, JSON.stringify(head, null, 2) + "\n", "utf8");
  } else {
    throw new Error("compare needs either a suite path or --head <result.json>");
  }

  const cmp = compareRuns(baseline, head, { tolerance: numFlag(args, "tolerance", 0) });

  if (boolFlag(args, "json")) console.log(JSON.stringify(cmp, null, 2));
  else console.log(renderCompareTerminal(cmp));

  const md = renderCompareMarkdown(cmp, head.suite);
  const mdOut = strFlag(args, "md");
  if (mdOut) await writeFile(mdOut, md + "\n", "utf8");

  if (boolFlag(args, "comment")) {
    const ctx = contextFromEnv(process.env);
    if (!ctx) {
      console.error("[evalgate] --comment set but no GitHub PR context found; skipping.");
    } else {
      try {
        await upsertComment(ctx, md);
        console.log(`[evalgate] posted report to ${ctx.owner}/${ctx.repo}#${ctx.prNumber}`);
      } catch (err) {
        // Reporting is a side-effect: a failure (e.g. read-only fork token, HTTP 403)
        // must not turn a passing comparison into a failed gate.
        const status = err instanceof Error ? err.message : String(err);
        console.error(`[evalgate] warning: could not post PR comment; skipping. (${status})`);
      }
    }
  }

  return cmp.regressed && !boolFlag(args, "no-fail") ? 1 : 0;
}

function cmdList(): number {
  const scorers = defaultScorerRegistry().list().sort();
  const providers = defaultRegistry(process.env).list().sort();

  console.log("Registered scorers:");
  for (const s of scorers) console.log(`  - ${s}`);

  console.log("\nRegistered providers:");
  for (const p of providers) console.log(`  - ${p}`);
  return 0;
}

const STARTER_SUITE = `name: my-suite
description: A starter evalgate suite. Runs on the mock provider with no API key.
provider: mock
model: mock
threshold: 0.9
cases:
  - id: hello
    input:
      prompt: |
        Reply with the greeting.
        exactly: Hello, world!
    expected: "Hello, world!"
    scorers:
      - type: exact-match
      - type: latency
        budgetMs: 500
`;

async function cmdInit(args: ParsedArgs): Promise<number> {
  const out = args._[0] ?? strFlag(args, "out") ?? "my-suite.eval.yaml";
  await writeFile(out, STARTER_SUITE, { encoding: "utf8", flag: "wx" }).catch((err) => {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`refusing to overwrite existing file ${out}`);
    }
    throw err;
  });
  console.log(`Wrote starter suite -> ${out}\nRun it with: evalgate run ${out}`);
  return 0;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (boolFlag(args, ["version", "v"])) {
    console.log(version());
    return 0;
  }
  const command = args._.shift();
  if (!command || boolFlag(args, ["help", "h"]) || command === "help") {
    console.log(CLI_HELP);
    return 0;
  }

  switch (command) {
    case "run":
      return cmdRun(args);
    case "baseline":
      return cmdBaseline(args);
    case "compare":
      return cmdCompare(args);
    case "list":
      return cmdList();
    case "init":
      return cmdInit(args);
    default:
      console.error(`[evalgate] unknown command "${command}"\n`);
      console.log(CLI_HELP);
      return 2;
  }
}

// Run the CLI only when this module is the entry point, so importing it in
// tests does not execute main() against the test runner's argv.
const invoked = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false;
if (invoked) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error((err as Error).message);
      process.exit(2);
    });
}
