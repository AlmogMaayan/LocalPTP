/**
 * LM Studio model client (HLD-SRD §3.8, §12).
 *
 * Speaks the OpenAI-compatible REST API behind the single `ModelClient` seam,
 * using the Node 20 built-in `fetch` + `AbortController` for timeouts. All
 * transport/protocol failures are mapped to a typed `ModelClientError` whose
 * `kind` callers branch on without string-matching.
 */
import {
  type ModelClient,
  type ModelRequest,
  type ModelResponse,
  type HealthResult,
  ModelClientError,
} from "../types/model.js";

export interface LmStudioClientOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  temperature?: number;
  timeoutMs?: number;
}

function connectionMessage(baseUrl: string): string {
  return (
    `Cannot connect to LM Studio at ${baseUrl}. ` +
    `Make sure LM Studio Local Server is running and the model is loaded.`
  );
}

/** Join the base (which ends in /v1) with an endpoint path. */
function urlFor(baseUrl: string, endpoint: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${endpoint.replace(/^\/+/, "")}`;
}

export class LmStudioClient implements ModelClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly temperature: number;
  private readonly timeoutMs: number;

  constructor(opts: LmStudioClientOptions) {
    this.baseUrl = opts.baseUrl;
    this.model = opts.model;
    this.apiKey = opts.apiKey ?? "lm-studio";
    this.temperature = opts.temperature ?? 0.2;
    this.timeoutMs = opts.timeoutMs ?? 60000;
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${this.apiKey}`,
    };
  }

  /**
   * Run a fetch with a timeout, translating transport failures (refused/timeout)
   * into typed errors. The timeout covers BOTH the headers AND the body read:
   * the abort timer stays armed until the body has been consumed, so a server
   * that sends headers and then stalls the body cannot hang past `timeoutMs`.
   */
  private async request(
    url: string,
    init: RequestInit,
  ): Promise<{ status: number; ok: boolean; text: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      // Read the body within the same abortable window so a stalled body still
      // trips the timeout rather than hanging indefinitely.
      const text = await res.text();
      return { status: res.status, ok: res.ok, text };
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new ModelClientError(
          "timeout",
          `Request to LM Studio at ${this.baseUrl} timed out after ${this.timeoutMs}ms. ` +
            connectionMessage(this.baseUrl),
          this.baseUrl,
          err,
        );
      }
      throw new ModelClientError(
        "refused",
        connectionMessage(this.baseUrl),
        this.baseUrl,
        err,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const url = urlFor(this.baseUrl, "chat/completions");
    const body = {
      model: this.model,
      messages: [
        { role: "system", content: req.systemPrompt },
        { role: "user", content: req.userPrompt },
      ],
      temperature: req.temperature ?? this.temperature,
      ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
    };

    const res = await this.request(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    const text = res.text;

    if (!res.ok) {
      // Non-2xx: distinguish model-not-loaded from a generic failure.
      if (this.looksLikeModelNotLoaded(res.status, text)) {
        throw new ModelClientError(
          "model-not-loaded",
          `LM Studio at ${this.baseUrl} has no model loaded (HTTP ${res.status}). ` +
            connectionMessage(this.baseUrl),
          this.baseUrl,
        );
      }
      throw new ModelClientError(
        "refused",
        `LM Studio at ${this.baseUrl} returned HTTP ${res.status}. ` +
          connectionMessage(this.baseUrl),
        this.baseUrl,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new ModelClientError(
        "malformed",
        "Model returned an empty/invalid response.",
        this.baseUrl,
        err,
      );
    }

    const content = this.extractContent(parsed);
    if (content === undefined || content.length === 0) {
      throw new ModelClientError(
        "empty",
        "Model returned an empty/invalid response.",
        this.baseUrl,
      );
    }

    return { content, raw: parsed };
  }

  async health(): Promise<HealthResult> {
    const url = urlFor(this.baseUrl, "models");
    const res = await this.request(url, {
      method: "GET",
      headers: this.headers(),
    });

    if (!res.ok) {
      throw new ModelClientError(
        "model-not-loaded",
        `LM Studio at ${this.baseUrl} returned HTTP ${res.status} for /models. ` +
          connectionMessage(this.baseUrl),
        this.baseUrl,
      );
    }

    const text = res.text;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new ModelClientError(
        "malformed",
        "Model returned an empty/invalid response.",
        this.baseUrl,
        err,
      );
    }

    const models = this.extractModels(parsed);
    return { reachable: true, models };
  }

  private looksLikeModelNotLoaded(status: number, body: string): boolean {
    if (status === 404) return true;
    const lower = body.toLowerCase();
    return (
      lower.includes("model_not_found") ||
      lower.includes("not found") ||
      lower.includes("no model")
    );
  }

  private extractContent(parsed: unknown): string | undefined {
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const choices = (parsed as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || choices.length === 0) return undefined;
    const first = choices[0];
    if (typeof first !== "object" || first === null) return undefined;
    const message = (first as { message?: unknown }).message;
    if (typeof message !== "object" || message === null) return undefined;
    const content = (message as { content?: unknown }).content;
    return typeof content === "string" ? content : undefined;
  }

  private extractModels(parsed: unknown): string[] {
    if (typeof parsed !== "object" || parsed === null) return [];
    const data = (parsed as { data?: unknown }).data;
    if (!Array.isArray(data)) return [];
    return data
      .map((d) =>
        typeof d === "object" && d !== null
          ? (d as { id?: unknown }).id
          : undefined,
      )
      .filter((id): id is string => typeof id === "string");
  }
}
