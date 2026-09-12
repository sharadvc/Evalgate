export const CLI_HELP = `evalgate - the build fails when your prompt gets dumber.

Usage:
  evalgate run <suite>            Run a suite and print a report.
  evalgate baseline <suite>       Run a suite and save it as a baseline.
  evalgate compare <suite>        Run a suite and compare it to a baseline.
  evalgate compare               Compare two existing result files.
  evalgate init [file]            Write a starter suite you can edit.
  evalgate list                   List the available scorers and providers.

Common flags:
  --provider <name>     Override the provider (default: mock).
  --model <name>        Override the model.
  --tags <a,b>          Only run cases with one of these tags.
  --concurrency <n>     Run cases in parallel (default: 1).
  --out <file>          Write the JSON result artifact here.
  --md <file>           Write a Markdown report here.
  --junit <file>        Write a JUnit XML report here.
  --json                Print the JSON result to stdout.
  --no-fail             Do not exit non-zero on failure/regression.
  --degrade             Use degraded mock outputs (for regression demos).

compare flags:
  --base <file>         Baseline result JSON (required for compare).
  --head <file>         Candidate result JSON (skips running the suite).
  --tolerance <n>       Allowed score drop before it counts as a regression.
  --comment             Upsert a PR comment via the GitHub API (needs token).

Other:
  --version, -v         Print version.
  --help, -h            Print this help.
`;
