import { describe, it, expect } from "vitest";
import { CLI_HELP } from "../src/cli/help.js";

describe("CLI help text", () => {
  it("documents --concurrency, --junit, and --degrade", () => {
    expect(CLI_HELP).toContain("--concurrency");
    expect(CLI_HELP).toContain("--junit");
    expect(CLI_HELP).toContain("--degrade");
  });
});
