import { describe, expect, test } from "bun:test";
import worker from "./index";

const ENV: Env = {
  ZAPI_TOOLSETS: "*",
  MCP_AUTH_TOKEN: "NOSCETEIPSUM",
  ZAPI_INSTANCE_ID: "inst-secret-id",
  ZAPI_INSTANCE_TOKEN: "inst-secret-token",
  ZAPI_CLIENT_TOKEN: "client-secret-token",
};

const CTX = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as ExecutionContext;

describe("Worker fetch", () => {
  test("GET /health is public", async () => {
    const response = await worker.fetch(
      new Request("https://whatsmcp.unfld.dev/health"),
      ENV,
      CTX,
    );
    expect(response.status).toBe(200);
    expect(await response.json() as { ok: boolean; name: string }).toEqual({
      ok: true,
      name: "whatsmcp",
    });
  });

  test("POST /mcp without auth is 401 with WWW-Authenticate: Bearer", async () => {
    const response = await worker.fetch(
      new Request("https://whatsmcp.unfld.dev/mcp", { method: "POST" }),
      ENV,
      CTX,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
  });

  test("unknown routes are 404", async () => {
    const response = await worker.fetch(
      new Request("https://whatsmcp.unfld.dev/other"),
      ENV,
      CTX,
    );
    expect(response.status).toBe(404);
  });
});
