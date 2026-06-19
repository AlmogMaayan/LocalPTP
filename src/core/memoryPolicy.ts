/**
 * Memory update policy (HLD-SRD §3.4, 0001_07).
 *
 * The §3.4 policy table maps canonical change types to their single target file.
 * The model proposes {changeType, content} only — the code picks the file via
 * POLICY. Out-of-table change types are dropped + warned (blocks .env/secret
 * writes, §13).
 *
 * `normalize(loose)` maps loose model strings to canonical keys.
 * `headingFor(key)` returns the section heading to append under.
 */

/** The §3.4 update-policy table: changeType → target memory file. */
export const POLICY: Readonly<Record<string, string>> = {
  "file-responsibility": "file-index.md",
  "api-behavior": "api-map.md",
  "data-model": "data-model.md",
  "architectural-decision": "decisions.md",
  "external-integration": "external-integrations.md",
  "testing-process": "test-plan.md",
  risk: "known-issues.md",
};

/** Human-readable section heading for each canonical change type. */
const HEADINGS: Readonly<Record<string, string>> = {
  "file-responsibility": "File Responsibility Changes",
  "api-behavior": "API Behavior Changes",
  "data-model": "Data Model Changes",
  "architectural-decision": "Architectural Decisions",
  "external-integration": "External Integration Changes",
  "testing-process": "Testing Process Changes",
  risk: "Risks / Known Issues",
};

// Ordered normalization rules: each entry is [pattern, canonical key].
// Evaluated in order — first match wins.
const NORMALIZE_RULES: Array<[RegExp, string]> = [
  // Exact canonical key first (identity pass)
  [/^file-responsibility$/i, "file-responsibility"],
  [/^api-behavior$/i, "api-behavior"],
  [/^data-model$/i, "data-model"],
  [/^architectural-decision$/i, "architectural-decision"],
  [/^external-integration$/i, "external-integration"],
  [/^testing-process$/i, "testing-process"],
  [/^risk$/i, "risk"],
  // Loose matches
  [/\bapi\b|\bendpoint\b/i, "api-behavior"],
  [/\barchitectural\b|\bdecision\b/i, "architectural-decision"],
  [/\brisk\b|\bbug\b/i, "risk"],
  [/\btest(ing)?\b/i, "testing-process"],
  [/\bfile\b|\bmodule\b/i, "file-responsibility"],
  [/\bdata\b|\bschema\b/i, "data-model"],
  [/\bintegration\b|\bexternal\b/i, "external-integration"],
];

/**
 * Map a loose model-provided change type string to its canonical key.
 * Returns `undefined` for an unknown/unmapped change type.
 */
export function normalize(loose: string): string | undefined {
  const trimmed = loose.trim();
  if (trimmed.length === 0) return undefined;
  for (const [pattern, key] of NORMALIZE_RULES) {
    if (pattern.test(trimmed)) return key;
  }
  return undefined;
}

/**
 * Return the section heading for a canonical change-type key.
 * Returns `undefined` for an unknown key.
 */
export function headingFor(key: string): string | undefined {
  return HEADINGS[key];
}
