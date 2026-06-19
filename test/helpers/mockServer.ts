import http from "node:http";
import type { AddressInfo } from "node:net";

export interface MockServer {
  baseUrl: string;
  port: number;
  close(): Promise<void>;
}

export type MockHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: string,
) => void;

/**
 * Start an ephemeral HTTP server on port 0. `baseUrl` is the OpenAI-style base
 * (e.g. http://127.0.0.1:PORT/v1) the ModelClient is pointed at.
 */
export async function startMockServer(
  handler: MockHandler,
): Promise<MockServer> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      handler(req, res, Buffer.concat(chunks).toString("utf8"));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

/**
 * Return a base_url pointing at a port that is (almost certainly) closed, to
 * simulate connection-refused without binding anything.
 */
export function closedPortBaseUrl(): string {
  // Port 1 is privileged and never has an OpenAI server; connect is refused.
  return "http://127.0.0.1:1/v1";
}
