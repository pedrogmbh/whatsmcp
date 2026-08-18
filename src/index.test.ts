import { describe, expect, test } from "bun:test";
import { ICON_SVG } from "./icon";
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

  test("GET /icon.svg is public", async () => {
    const response = await worker.fetch(
      new Request("https://whatsmcp.unfld.dev/icon.svg"),
      ENV,
      CTX,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("image/svg+xml");
    const svg = await response.text();
    expect(svg).toContain("<svg");
    expect(svg).toContain("#25D366");
    expect(svg).toBe(ICON_SVG);
    expect(await Bun.file("public/icon.svg").text()).toBe(ICON_SVG);
  });

  test("GET /icon.png is public", async () => {
    const response = await worker.fetch(
      new Request("https://whatsmcp.unfld.dev/icon.png"),
      ENV,
      CTX,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.subarray(0, 8)).toEqual(
      Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    );
  });
});
