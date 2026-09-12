/** A parsed command line: the positional args plus a flag map. */
export interface ParsedArgs {
  _: string[];
  flags: Record<string, string | boolean>;
}

/**
 * A tiny, dependency-free argument parser. Supports:
 *   --flag value | --flag=value | --bool | -x value
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const _: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token.startsWith("--")) {
      const body = token.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          flags[body] = next;
          i++;
        } else {
          flags[body] = true;
        }
      }
    } else if (token.startsWith("-") && token.length > 1) {
      const key = token.slice(1);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      _.push(token);
    }
  }

  return { _, flags };
}

/** Read a string flag, honoring aliases, with an optional default. */
export function strFlag(
  args: ParsedArgs,
  keys: string | string[],
  fallback?: string,
): string | undefined {
  for (const k of Array.isArray(keys) ? keys : [keys]) {
    const v = args.flags[k];
    if (typeof v === "string") return v;
  }
  return fallback;
}

/** Read a boolean flag. */
export function boolFlag(args: ParsedArgs, keys: string | string[]): boolean {
  for (const k of Array.isArray(keys) ? keys : [keys]) {
    if (args.flags[k] === true || args.flags[k] === "true") return true;
  }
  return false;
}

/** Raised when a numeric flag is present but not a valid number. */
export class InvalidNumericFlagError extends Error {
  constructor(flag: string, raw: string) {
    super(`[evalgate] invalid numeric flag --${flag}: "${raw}"`);
    this.name = "InvalidNumericFlagError";
  }
}

/** Read a numeric flag with an optional default. */
export function numFlag(
  args: ParsedArgs,
  keys: string | string[],
  fallback?: number,
): number | undefined {
  const keyList = Array.isArray(keys) ? keys : [keys];
  for (const k of keyList) {
    const v = args.flags[k];
    if (typeof v !== "string") continue;
    const n = Number(v);
    if (Number.isNaN(n)) throw new InvalidNumericFlagError(k, v);
    return n;
  }
  return fallback;
}
