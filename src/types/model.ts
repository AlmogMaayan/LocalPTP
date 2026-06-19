/**
 * Model client types — the single swappable provider seam (HLD-SRD §3.8, §9).
 */

export type AgentRole =
  | "planner"
  | "retriever"
  | "coder"
  | "reviewer"
  | "test-fixer"
  | "summarizer";

export interface ModelRequest {
  role: AgentRole;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ModelResponse {
  content: string;
  raw?: unknown;
}

export interface HealthResult {
  reachable: boolean;
  models?: string[];
  error?: string;
}

export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelResponse>;
  health(): Promise<HealthResult>;
}

/**
 * The distinct §12 failure kinds. Callers (e.g. `doctor`) branch on `kind`
 * instead of string-matching messages.
 */
export type ModelClientErrorKind =
  | "refused"
  | "timeout"
  | "model-not-loaded"
  | "empty"
  | "malformed";

export class ModelClientError extends Error {
  readonly kind: ModelClientErrorKind;
  readonly baseUrl: string;
  override readonly cause?: unknown;

  constructor(
    kind: ModelClientErrorKind,
    message: string,
    baseUrl: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "ModelClientError";
    this.kind = kind;
    this.baseUrl = baseUrl;
    this.cause = cause;
  }
}
