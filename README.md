# evalgate

**The build fails when your prompt gets dumber.**

[![CI](https://github.com/AgentPostmortem/evalgate/actions/workflows/ci.yml/badge.svg)](https://github.com/AgentPostmortem/evalgate/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@royalpinto007/evalgate.svg)](https://www.npmjs.com/package/@royalpinto007/evalgate)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)

evalgate is prompt/agent regression CI. You write a declarative eval suite, evalgate
runs it, scores it, stores a baseline, and on every pull request it re-runs the suite,
computes the quality delta against the base branch, and **fails the build when the
score drops** - then posts the delta table as a PR comment.

It runs end to end with **zero API keys** thanks to a deterministic mock provider, so
you can try the whole thing (and the test suite) offline.

---

## Why

Prompts and agents rot silently. A model swap, a "small" prompt tweak, a new tool - any
of them can quietly make your system dumber, and you find out in production. Unit tests
don't catch it because there's nothing throwing; the output is just *worse*.

evalgate treats quality like a build artifact:

- **Declarative suites** - cases live in version control next to your code.
- **Real scorers** - exact match, regex, JSON-schema, semantic similarity, LLM-as-judge,
  latency/cost budgets, and weighted rubrics.
- **Baseline + delta** - the core value. Not "is this good?" but "is this *worse than it
  was*?" - the only question CI can answer objectively.
- **Provider-agnostic** - a clean adapter layer for OpenAI, Anthropic, Groq, and
  OpenRouter, plus a deterministic mock so tests need no network.
- **A real GitHub Action** - drops the delta into a PR comment and gates the merge.

---

**npm:** https://www.npmjs.com/package/@royalpinto007/evalgate

## Quickstart

```bash
npm install -D @royalpinto007/evalgate   # or: npm install -g @royalpinto007/evalgate
```

Write a suite (`suite.eval.yaml`):

```yaml
name: my-agent
provider: mock          # works with no API key
temperature: 0          # deterministic by default; case values override
maxTokens: 512          # optional output cap; case values override
threshold: 0.9          # mean score required to pass
cases:
  - id: greeting
    input:
      prompt: |
        Reply with the standard greeting.
        exactly: Hi there! How can I help you today?
    expected: "Hi there! How can I help you today?"
    scorers:
      - type: exact-match
      - type: latency
        budgetMs: 500
```

Run it:

```bash
npx @royalpinto007/evalgate run suite.eval.yaml
```

Save a baseline, then compare later runs against it:

```bash
npx @royalpinto007/evalgate baseline suite.eval.yaml --out baseline.json
npx @royalpinto007/evalgate compare suite.eval.yaml --base baseline.json --tolerance 0.01
```

`compare` exits non-zero when any case regresses beyond the tolerance - that is what
fails your CI job.

> Try it right now on the bundled example:
> `npx @royalpinto007/evalgate run examples/support-agent.eval.yaml`

---

## Suite format

A suite is YAML or JSON with this shape:

| Field | Where | Meaning |
| --- | --- | --- |
| `name` | suite | Suite name shown in reports. Required. |
| `provider` | suite / case | Provider to call (`mock`, `openai`, `anthropic`, `groq`, `openrouter`). |
| `model` | suite / case | Model id. Case overrides suite. |
| `temperature` | suite / case | Non-negative sampling temperature. Case overrides suite; default `0`. Provider-specific upper limits still apply. |
| `maxTokens` | suite / case | Positive integer output-token cap. Case overrides suite; omitted by default. |
| `threshold` | suite | Mean score in `[0,1]` required for the run to pass. |
| `cases[].id` | case | Unique id. Required. |
| `cases[].input.prompt` | case | A single-string prompt. |
| `cases[].input.messages` | case | Chat messages `[{role, content}]` (alternative to `prompt`). |
| `cases[].expected` | case | Reference value shared by several scorers. |
| `cases[].scorers` | case | One or more scorer specs. Required. |
| `cases[].tags` | case | Tags for `--tags` filtering. |

Each scorer spec has a `type`, an optional `weight` (default `1`), an optional `name`,
and scorer-specific options. A case passes when **every** scorer passes; its numeric
score is the weighted mean of the scorer scores.

---

## Scorer catalog

| Scorer | Passes when | Key options |
| --- | --- | --- |
| `exact-match` | output equals `expected` | `expected`, `caseSensitive`, `trim` |
| `regex` | output matches a pattern | `pattern`, `flags`, `expectMatch` |
| `contains` | all substrings present (partial credit) | `value` / `values`, `caseSensitive` |
| `not-contains` | no banned substring present | `value` / `values`, `caseSensitive` |
| `json-schema` | output is valid JSON matching a schema | `schema` |
| `embedding-similarity` | cosine similarity >= threshold | `expected`, `threshold` |
| `llm-judge` | a judge model scores >= threshold | `criteria`, `expected`, `threshold`, `model` |
| `latency` | call latency within budget | `budgetMs` |
| `cost` | estimated call cost within budget | `budgetUsd` (provider must set `costPer1kTokens` so `costUsd` is reported) |
| `rubric` | weighted criteria score >= threshold | `criteria[]`, `threshold` |

Two scorers are pluggable and ship with **deterministic offline fallbacks** so tests and
the mock provider need no network:

- `embedding-similarity` uses the provider's `embed()` if present, otherwise a stable
  local bag-of-hashed-words embedding.
- `llm-judge` calls a real provider and parses a JSON `{score, reason}` reply; on the
  `mock` provider it computes a reproducible word-overlap score instead.

---

## The PR comment

On each PR the Action re-runs the suite and upserts a single comment (it edits its own
comment in place rather than stacking new ones). A regression looks like this:

---

### evalgate: support-agent

**FAIL** - Quality regressed. 5 case(s) got worse.

Overall score: **94.2%** (base) -> **60.1%** (head) = **-34.2pp**

| Case | Base | Head | Delta | Change |
| --- | --- | --- | --- | --- |
| `refund-intent-json` | 100.0% | 0.0% | -100.0pp | down |
| `order-id-format` | 100.0% | 0.0% | -100.0pp | down |
| `greeting-exact` | 100.0% | 66.7% | -33.3pp | down |
| `judge-helpfulness` | 73.6% | 69.1% | -4.5pp | down |
| `paraphrase-quality` | 86.0% | 84.6% | -1.3pp | down |

_tolerance 0.0% - worst case -100.0pp_

---

## GitHub Action usage

```yaml
name: evalgate
on:
  pull_request:
permissions:
  contents: read
  pull-requests: write        # required for the PR comment
jobs:
  quality-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: AgentPostmortem/evalgate@v0
        with:
          suite: examples/support-agent.eval.yaml
          baseline: examples/support-agent.baseline.json
          provider: mock          # or openai / anthropic / groq / openrouter
          tolerance: "0.01"
          comment: "true"
```

| Input | Default | Description |
| --- | --- | --- |
| `suite` | - | Path to the eval suite (required). |
| `baseline` | `evalgate.baseline.json` | Baseline result to compare against. |
| `provider` | `mock` | Provider to run with. |
| `model` | - | Optional model override. |
| `tolerance` | `0` | Allowed per-case score drop before it's a regression. |
| `comment` | `true` | Upsert a PR comment with the delta table. |
| `github-token` | `${{ github.token }}` | Token used to post the comment. |

For real providers, pass the relevant key as an env var / secret:
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, or `OPENROUTER_API_KEY`.

---

## CLI

```
evalgate run <suite>          Run a suite and print a report.
evalgate baseline <suite>     Run a suite and save it as a baseline.
evalgate compare <suite>      Run a suite and compare it to a baseline.
evalgate compare             Compare two existing result files (--base, --head).
evalgate init [file]          Write a starter suite you can edit.
evalgate list                 List the available scorers and providers.

Flags: --provider --model --tags --concurrency --out --md --junit --json
       --tolerance --comment --no-fail
```

## Library

evalgate is also a library:

```ts
import { loadSuite, runSuite, compareRuns, renderCompareMarkdown } from "evalgate";

const suite = await loadSuite("suite.eval.yaml");
const head = await runSuite(suite);
const baseline = JSON.parse(await fs.readFile("baseline.json", "utf8"));
const cmp = compareRuns(baseline, head, { tolerance: 0.01 });
if (cmp.regressed) process.exit(1);
console.log(renderCompareMarkdown(cmp, suite.name));
```

Register your own scorer or provider:

```ts
import { defaultScorerRegistry, defaultRegistry } from "evalgate";

const scorers = defaultScorerRegistry().register({
  type: "starts-with",
  score: (spec, ctx) => ({
    type: "starts-with",
    name: "starts-with",
    weight: spec.weight ?? 1,
    passed: ctx.output.startsWith(String(spec.prefix)),
    score: ctx.output.startsWith(String(spec.prefix)) ? 1 : 0,
    reason: "prefix check",
  }),
});
```

---

## Development

```bash
npm install
npm run build       # compile to dist/
npm test            # vitest
npm run typecheck
npm run lint
```

## Contributing

Issues and PRs are welcome. Please keep the mock-first rule: every feature must run and
be tested without network access or API keys. Run `npm test`, `npm run typecheck`, and
`npm run lint` before opening a PR, and add a case to the example suites when you add a
scorer.

## License

[MIT](./LICENSE) (c) royalpinto007
