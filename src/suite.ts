import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { EvalCase, EvalSuite, Message, ScorerSpec } from "./types.js";

/** Raised when a suite fails structural validation. */
export class SuiteValidationError extends Error {
  constructor(message: string) {
    super(`[evalgate] invalid suite: ${message}`);
    this.name = "SuiteValidationError";
  }
}

/** Parse a suite from a raw string. `.yaml`/`.yml` and `.json` are supported. */
export function parseSuite(raw: string, filename = "suite"): EvalSuite {
  const isJson = filename.endsWith(".json");
  let data: unknown;
  try {
    data = isJson ? JSON.parse(raw) : parseYaml(raw);
  } catch (err) {
    throw new SuiteValidationError(`could not parse ${filename}: ${(err as Error).message}`);
  }
  return validateSuite(data);
}

/** Load and validate a suite from a file path. */
export async function loadSuite(path: string): Promise<EvalSuite> {
  const raw = await readFile(path, "utf8");
  return parseSuite(raw, path);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SuiteValidationError(message);
}

const MESSAGE_ROLES = new Set<Message["role"]>(["system", "user", "assistant"]);

function validateMessages(
  messages: unknown[],
  caseId: string,
): EvalCase["input"]["messages"] {
  assert(messages.length > 0, `case "${caseId}" input.messages must not be empty`);
  return messages.map((m, i) => {
    assert(m && typeof m === "object", `case "${caseId}" messages[${i}] must be an object`);
    const msg = m as Record<string, unknown>;
    assert(
      typeof msg.role === "string" && MESSAGE_ROLES.has(msg.role as Message["role"]),
      `case "${caseId}" messages[${i}].role must be system, user, or assistant`,
    );
    assert(typeof msg.content === "string", `case "${caseId}" messages[${i}].content must be a string`);
    return { role: msg.role as Message["role"], content: msg.content };
  });
}

/** Validate an arbitrary object into a typed {@link EvalSuite}. */
export function validateSuite(data: unknown): EvalSuite {
  assert(data && typeof data === "object", "suite must be an object");
  const d = data as Record<string, unknown>;

  assert(typeof d.name === "string" && d.name.length > 0, "suite.name is required");
  assert(Array.isArray(d.cases), "suite.cases must be an array");
  assert((d.cases as unknown[]).length > 0, "suite.cases must not be empty");

  if (d.threshold !== undefined) {
    assert(
      typeof d.threshold === "number" && d.threshold >= 0 && d.threshold <= 1,
      "suite.threshold must be a number in [0, 1]",
    );
  }
  validateSamplingOptions(d, "suite");

  const ids = new Set<string>();
  const cases = (d.cases as unknown[]).map((c, i) => validateCase(c, i, ids));

  return {
    name: d.name,
    description: typeof d.description === "string" ? d.description : undefined,
    model: typeof d.model === "string" ? d.model : undefined,
    provider: typeof d.provider === "string" ? d.provider : undefined,
    temperature: typeof d.temperature === "number" ? d.temperature : undefined,
    maxTokens: typeof d.maxTokens === "number" ? d.maxTokens : undefined,
    threshold: typeof d.threshold === "number" ? d.threshold : undefined,
    vars: isVars(d.vars) ? d.vars : undefined,
    cases,
  };
}

function isVars(v: unknown): v is Record<string, string | number | boolean> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every(
    (x) => typeof x === "string" || typeof x === "number" || typeof x === "boolean",
  );
}

function validateSamplingOptions(data: Record<string, unknown>, label: string): void {
  if (data.temperature !== undefined) {
    assert(
      typeof data.temperature === "number" &&
        Number.isFinite(data.temperature) &&
        data.temperature >= 0,
      `${label}.temperature must be a non-negative finite number`,
    );
  }
  if (data.maxTokens !== undefined) {
    assert(
      typeof data.maxTokens === "number" &&
        Number.isInteger(data.maxTokens) &&
        data.maxTokens > 0,
      `${label}.maxTokens must be a positive integer`,
    );
  }
}

function validateCase(data: unknown, index: number, ids: Set<string>): EvalCase {
  assert(data && typeof data === "object", `cases[${index}] must be an object`);
  const c = data as Record<string, unknown>;

  assert(typeof c.id === "string" && c.id.length > 0, `cases[${index}].id is required`);
  assert(!ids.has(c.id), `duplicate case id "${c.id}"`);
  ids.add(c.id);

  assert(c.input && typeof c.input === "object", `case "${c.id}" requires an input object`);
  const input = c.input as Record<string, unknown>;
  const hasPrompt = typeof input.prompt === "string";
  const hasMessages = Array.isArray(input.messages);
  assert(hasPrompt || hasMessages, `case "${c.id}" input needs a prompt or messages`);
  if (hasPrompt) {
    assert((input.prompt as string).length > 0, `case "${c.id}" input.prompt must not be empty`);
  }

  assert(Array.isArray(c.scorers), `case "${c.id}" requires a scorers array`);
  assert((c.scorers as unknown[]).length > 0, `case "${c.id}" needs at least one scorer`);
  const scorers = (c.scorers as unknown[]).map((s, i) => validateScorer(s, c.id as string, i));
  validateSamplingOptions(c, `case "${c.id}"`);

  return {
    id: c.id,
    description: typeof c.description === "string" ? c.description : undefined,
    input: {
      prompt: hasPrompt ? (input.prompt as string) : undefined,
      messages: hasMessages ? validateMessages(input.messages as unknown[], c.id as string) : undefined,
    },
    model: typeof c.model === "string" ? c.model : undefined,
    provider: typeof c.provider === "string" ? c.provider : undefined,
    temperature: typeof c.temperature === "number" ? c.temperature : undefined,
    maxTokens: typeof c.maxTokens === "number" ? c.maxTokens : undefined,
    expected: typeof c.expected === "string" ? c.expected : undefined,
    scorers,
    tags: Array.isArray(c.tags) ? (c.tags as string[]).map(String) : undefined,
    vars: isVars(c.vars) ? c.vars : undefined,
  };
}

function validateScorer(data: unknown, caseId: string, index: number): ScorerSpec {
  assert(data && typeof data === "object", `case "${caseId}" scorers[${index}] must be an object`);
  const s = data as Record<string, unknown>;
  assert(
    typeof s.type === "string" && s.type.length > 0,
    `case "${caseId}" scorers[${index}].type is required`,
  );
  if (s.weight !== undefined) {
    assert(
      typeof s.weight === "number" && s.weight >= 0,
      `case "${caseId}" scorers[${index}].weight must be a non-negative number`,
    );
  }
  return s as ScorerSpec;
}
