import { describe, it, expect, afterEach } from "vitest";
import { LmStudioClient } from "../../src/core/modelClient.js";
import { ModelClientError } from "../../src/types/model.js";
import {
  startMockServer,
  closedPortBaseUrl,
  type MockServer,
} from "../helpers/mockServer.js";

let server: MockServer | undefined;

afterEach(async () => {
  if (server) {
    await server.close();
    server = undefined;
  }
});

function client(baseUrl: string, timeoutMs = 5000): LmStudioClient {
  return new LmStudioClient({
    baseUrl,
    model: "test-model",
    apiKey: "lm-studio",
    temperature: 0.2,
    timeoutMs,
  });
}

const req = {
  role: "coder" as const,
  systemPrompt: "sys",
  userPrompt: "hi",
};

describe("LmStudioClient.complete", () => {
  it("6.2 returns choices[0].message.content on a 2xx mock", async () => {
    server = await startMockServer((r, res) => {
      expect(r.url).toContain("/chat/completions");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "hello there" } }],
        }),
      );
    });
    const res = await client(server.baseUrl).complete(req);
    expect(res.content).toBe("hello there");
  });
});

describe("LmStudioClient.health", () => {
  it("6.3 returns reachable + models on a 2xx GET /models mock", async () => {
    server = await startMockServer((r, res) => {
      expect(r.url).toContain("/models");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ data: [{ id: "qwen-a" }, { id: "qwen-b" }] }),
      );
    });
    const result = await client(server.baseUrl).health();
    expect(result.reachable).toBe(true);
    expect(result.models).toEqual(["qwen-a", "qwen-b"]);
  });
});

describe("LmStudioClient error map (§12)", () => {
  it("6.4 closed port -> ModelClientError{kind:'refused'} naming base_url", async () => {
    const baseUrl = closedPortBaseUrl();
    const err = await client(baseUrl).complete(req).catch((e) => e);
    expect(err).toBeInstanceOf(ModelClientError);
    expect((err as ModelClientError).kind).toBe("refused");
    expect((err as ModelClientError).message).toContain(baseUrl);
    expect((err as ModelClientError).message).toMatch(/LM Studio/i);
  });

  it("6.5 server slower than the abort timeout -> kind:'timeout'", async () => {
    server = await startMockServer((_r, res) => {
      // never respond within the timeout window
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: "late" } }] }));
      }, 1000);
    });
    const err = await client(server.baseUrl, 100)
      .complete(req)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ModelClientError);
    expect((err as ModelClientError).kind).toBe("timeout");
  });

  it("6.6 non-2xx with model-not-found body -> kind:'model-not-loaded'", async () => {
    server = await startMockServer((_r, res) => {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ error: { message: "model 'x' not found", code: "model_not_found" } }),
      );
    });
    const err = await client(server.baseUrl).complete(req).catch((e) => e);
    expect(err).toBeInstanceOf(ModelClientError);
    expect((err as ModelClientError).kind).toBe("model-not-loaded");
  });

  it("6.7 2xx empty content -> kind:'empty'", async () => {
    server = await startMockServer((_r, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "" } }] }));
    });
    const err = await client(server.baseUrl).complete(req).catch((e) => e);
    expect(err).toBeInstanceOf(ModelClientError);
    expect((err as ModelClientError).kind).toBe("empty");
  });

  it("6.7 2xx with no choices -> kind:'empty'", async () => {
    server = await startMockServer((_r, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [] }));
    });
    const err = await client(server.baseUrl).complete(req).catch((e) => e);
    expect((err as ModelClientError).kind).toBe("empty");
  });

  it("6.7 2xx malformed JSON -> kind:'malformed'", async () => {
    server = await startMockServer((_r, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("this is not json{{{");
    });
    const err = await client(server.baseUrl).complete(req).catch((e) => e);
    expect(err).toBeInstanceOf(ModelClientError);
    expect((err as ModelClientError).kind).toBe("malformed");
  });
});
