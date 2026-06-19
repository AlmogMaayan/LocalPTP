import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { runDoctor } from "../../src/commands/doctor.js";
import {
  startMockServer,
  closedPortBaseUrl,
  type MockServer,
} from "../helpers/mockServer.js";
import { ModelClientError } from "../../src/types/model.js";

let tmp: string;
let server: MockServer | undefined;

async function writeConfig(baseUrl: string): Promise<void> {
  const file = path.join(tmp, ".ai-orchestrator", "config.yml");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    yaml.dump({ model: { base_url: baseUrl, timeout_ms: 2000 } }),
    "utf8",
  );
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lc-doc-"));
});

afterEach(async () => {
  if (server) {
    await server.close();
    server = undefined;
  }
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("runDoctor", () => {
  it("10.1 with server down, throws the §12 connection error", async () => {
    await writeConfig(closedPortBaseUrl());
    const err = await runDoctor({ cwd: tmp }).catch((e) => e);
    expect(err).toBeInstanceOf(ModelClientError);
    expect((err as ModelClientError).kind).toBe("refused");
    expect((err as ModelClientError).message).toContain(closedPortBaseUrl());
  });

  it("10.2 with server up, returns reachable + a latency in ms", async () => {
    server = await startMockServer((r, res) => {
      if (r.url?.includes("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "qwen-test" }] }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ choices: [{ message: { content: "pong" } }] }),
      );
    });
    await writeConfig(server.baseUrl);

    const result = await runDoctor({ cwd: tmp });
    expect(result.reachable).toBe(true);
    expect(result.model).toBe("qwen-test");
    expect(typeof result.latencyMs).toBe("number");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
