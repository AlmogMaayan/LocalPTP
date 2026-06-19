/**
 * Secret-safe local logger (HLD-SRD §13, §14).
 *
 * Writes `.ai-orchestrator/logs/YYYY-MM-DD.log`. Never logs secrets: bearer
 * tokens, api_key/apiKey values, and connection-string credentials are redacted
 * before anything is written. `debug` lines are written only when debug is on.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const REDACTED = "[REDACTED]";

/**
 * Redact common secret shapes from a line before it is written or printed.
 */
export function redactSecrets(line: string): string {
  return (
    line
      // Bearer tokens
      .replace(/(Bearer\s+)\S+/gi, `$1${REDACTED}`)
      // api_key / apiKey = "quoted value" (may contain whitespace) — redact the
      // whole quoted value so secrets with spaces never leak. The key itself may
      // be quoted too (JSON: "apiKey":"secret"). The value matcher is
      // escape-aware: an escaped quote (\") inside the value does NOT terminate
      // it, so the entire secret is redacted.
      .replace(
        /(["']?api[_-]?key["']?\s*[:=]\s*)(["'])(?:\\.|(?!\2)[\s\S])*\2/gi,
        `$1$2${REDACTED}$2`,
      )
      // api_key / apiKey = unquoted value. Redact the WHOLE plain scalar up to
      // the end of line or an inline ` #` comment — a YAML plain scalar may
      // contain spaces (e.g. `api_key: secret phrase`), so stopping at the first
      // space would leak the rest.
      .replace(
        /(["']?api[_-]?key["']?\s*[:=]\s*)(?!["'])[^\n\r]+/gi,
        `$1${REDACTED}`,
      )
      // Credentials embedded in a URL (user:pass@host) and the rest of the URL,
      // which may itself carry secrets — redact from the scheme onward. The
      // scheme grammar follows RFC 3986 (letters, then letters/digits/+/-/.) so
      // schemes like `mongodb+srv://` and `postgresql://` are covered.
      .replace(/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s]*@[^\s]+/g, REDACTED)
  );
}

export interface LoggerOptions {
  logsDir: string;
  debug?: boolean;
}

export interface Logger {
  info(message: string): Promise<void>;
  warn(message: string): Promise<void>;
  error(message: string): Promise<void>;
  debug(message: string): Promise<void>;
}

function dateStamp(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function createLogger(opts: LoggerOptions): Logger {
  const { logsDir, debug = false } = opts;

  async function write(level: string, message: string): Promise<void> {
    const safe = redactSecrets(message);
    const line = `${new Date().toISOString()} [${level}] ${safe}\n`;
    await fs.mkdir(logsDir, { recursive: true });
    await fs.appendFile(path.join(logsDir, `${dateStamp()}.log`), line, "utf8");
  }

  return {
    info: (m) => write("INFO", m),
    warn: (m) => write("WARN", m),
    error: (m) => write("ERROR", m),
    debug: async (m) => {
      if (!debug) return;
      await write("DEBUG", m);
    },
  };
}
