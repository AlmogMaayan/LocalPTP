/**
 * Config Manager (HLD-SRD §3.2, §9).
 *
 * - Defaults + validation live in the zod schema (single source of truth).
 * - On load: read YAML (snake_case) → map to camelCase → zod-parse (fills defaults).
 * - On write: map camelCase → snake_case → serialize with js-yaml.
 * - `set(dottedKey, value)`: coerce, set on the merged object, re-validate, write.
 * - Validation failures surface a `field.path: hint` message, never a raw stack.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { ZodError } from "zod";
import { appConfigSchema, type AppConfig } from "../types/config.js";
import { readIfExists } from "../utils/fs.js";
import { redactSecrets } from "../utils/logger.js";

type Json = unknown;

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function isPlainObject(v: Json): v is Record<string, Json> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function mapKeysDeep(value: Json, transform: (k: string) => string): Json {
  if (Array.isArray(value)) {
    return value.map((v) => mapKeysDeep(v, transform));
  }
  if (isPlainObject(value)) {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value)) {
      // Drop prototype-pollution keys from untrusted YAML before assignment so a
      // malicious `__proto__`/`constructor`/`prototype` key cannot mutate a
      // prototype during config load.
      if (FORBIDDEN_KEYS.has(k)) continue;
      const mapped = transform(k);
      if (FORBIDDEN_KEYS.has(mapped)) continue;
      Object.defineProperty(out, mapped, {
        value: mapKeysDeep(v, transform),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    return out;
  }
  return value;
}

export function snakeToCamelKeys(value: Json): Json {
  return mapKeysDeep(value, snakeToCamel);
}

export function camelToSnakeKeys(value: Json): Json {
  return mapKeysDeep(value, camelToSnake);
}

function formatZodError(err: ZodError): string {
  const lines = err.issues.map((issue) => {
    const where = issue.path.join(".") || "(root)";
    return `  ${where}: ${issue.message}`;
  });
  return `Invalid configuration:\n${lines.join("\n")}`;
}

/**
 * Coerce a string CLI value to boolean | number | string.
 */
export function coerceValue(value: string): boolean | number | string {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return value;
}

/**
 * Set a dotted key on `obj`. Every segment must already exist on the object
 * (no auto-vivification of unknown keys — that would let a typo silently write
 * an orphan key the schema then strips). Rejects prototype-pollution segments.
 * Throws if any segment is unknown.
 */
function setDottedPath(
  obj: Record<string, Json>,
  dotted: string,
  value: Json,
): void {
  const parts = dotted.split(".");
  if (parts.some((p) => FORBIDDEN_KEYS.has(p) || p.length === 0)) {
    throw new Error(`Invalid configuration key: ${dotted}`);
  }
  let cursor: Record<string, Json> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!isPlainObject(cursor[part])) {
      throw new Error(`Unknown configuration key: ${dotted}`);
    }
    cursor = cursor[part] as Record<string, Json>;
  }
  const leaf = parts[parts.length - 1];
  if (!Object.prototype.hasOwnProperty.call(cursor, leaf)) {
    throw new Error(`Unknown configuration key: ${dotted}`);
  }
  cursor[leaf] = value;
}

export class ConfigManager {
  constructor(private readonly configFile: string) {}

  /**
   * Load and validate config, filling defaults. Throws a formatted error
   * (field path + hint) on validation failure — never a raw stack.
   */
  async load(): Promise<AppConfig> {
    const raw = await readIfExists(this.configFile);
    let parsed: Json = {};
    if (raw !== undefined && raw.trim().length > 0) {
      try {
        parsed = yaml.load(raw) ?? {};
      } catch (err) {
        // js-yaml errors embed a snippet of the offending YAML, which can carry
        // a secret (e.g. `api_key: ...`). Redact before surfacing to stderr.
        throw new Error(
          redactSecrets(
            `Invalid YAML in ${this.configFile}: ${(err as Error).message}`,
          ),
        );
      }
    }
    const camel = snakeToCamelKeys(parsed);
    const result = appConfigSchema.safeParse(camel);
    if (!result.success) {
      throw new Error(formatZodError(result.error));
    }
    return result.data;
  }

  /**
   * Validate and write a config object as snake_case YAML.
   */
  async write(config: AppConfig): Promise<void> {
    const validated = appConfigSchema.parse(config);
    const snake = camelToSnakeKeys(validated);
    const text = yaml.dump(snake, { lineWidth: -1 });
    await fs.mkdir(path.dirname(this.configFile), { recursive: true });
    await fs.writeFile(this.configFile, text, "utf8");
  }

  /**
   * Write the default config only if no config file exists.
   * Returns true if created, false if preserved.
   */
  async writeDefaultIfAbsent(): Promise<boolean> {
    const existing = await readIfExists(this.configFile);
    if (existing !== undefined) {
      return false;
    }
    const defaults = appConfigSchema.parse({});
    await this.write(defaults);
    return true;
  }

  /**
   * Set one dotted (camelCase) key, coercing the value, re-validating, then
   * writing. An invalid value is NOT written.
   */
  async set(dottedKey: string, value: string): Promise<AppConfig> {
    const current = await this.load();
    const coerced = coerceValue(value);
    const draft = structuredClone(current) as Record<string, Json>;
    setDottedPath(draft, dottedKey, coerced);

    const result = appConfigSchema.safeParse(draft);
    if (!result.success) {
      // Filter to issues under the edited key for a focused message; fall back
      // to the full error if the path does not line up.
      const focused = new ZodError(
        result.error.issues.filter(
          (i) => i.path.join(".") === dottedKey,
        ),
      );
      const err = focused.issues.length > 0 ? focused : result.error;
      throw new Error(formatZodError(err));
    }
    await this.write(result.data);
    return result.data;
  }
}
