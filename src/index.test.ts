import { describe, expect, test } from "bun:test";
import { ICON_SVG } from "./icon";
import worker from "./index";
import { createMemoryD1, inboxTestSchema } from "./memory-d1";

const SCHEMA = await inboxTestSchema();

const ENV: Env = {
  ZAPI_TOOLSETS: "*",
  MCP_AUTH_TOKEN: "NOSCETEIPSUM",
  ZAPI_INSTANCE_ID: "inst-secret-id",
  ZAPI_INSTANCE_TOKEN: "inst-secret-token",
  ZAPI_CLIENT_TOKEN: "client-secret-token",
  WEBHOOK_AUTH_TOKEN: "webhook-secret-token",
  DB: createMemoryD1(SCHEMA),
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
  });

  test("POST /webhooks/on-message-received without token is 401", async () => {
    const response = await worker.fetch(
      new Request("https://whatsmcp.unfld.dev/webhooks/on-message-received", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: "x", type: "ReceivedCallback" }),
      }),
      ENV,
      CTX,
    );
    expect(response.status).toBe(401);
  });

  test("POST /webhooks/on-message-received stores the event", async () => {
    const env: Env = { ...ENV, DB: createMemoryD1(SCHEMA) };
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil(promise: Promise<unknown>) {
        pending.push(promise);
      },
      passThroughOnException() {},
      props: {},
    } as unknown as ExecutionContext;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      expect(url).toContain("/chats/5544999999999");
      return new Response(
        JSON.stringify({
          phone: "5544999999999",
          name: "Bacteria",
          tags: ["1", "3"],
          messagesUnread: 2,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const response = await worker.fetch(
        new Request(
          "https://whatsmcp.unfld.dev/webhooks/on-message-received?token=webhook-secret-token",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messageId: "MSG-1",
              phone: "5544999999999",
              type: "ReceivedCallback",
              text: { message: "hello inbox" },
              momment: 1,
            }),
          },
        ),
        env,
        ctx,
      );
      expect(response.status).toBe(200);
      expect(await response.json() as { ok: boolean }).toEqual({ ok: true });
      await Promise.all(pending);
    } finally {
      globalThis.fetch = originalFetch;
    }

    const listed = await env.DB.prepare(
      "SELECT text, phone FROM events WHERE message_id = ?",
    )
      .bind("MSG-1")
      .first<{ text: string; phone: string }>();
    expect(listed?.phone).toBe("5544999999999");
    expect(listed?.text).toContain("hello inbox");

    const tags = await env.DB.prepare(
      "SELECT tag FROM chat_tags WHERE phone = ? ORDER BY tag",
    )
      .bind("5544999999999")
      .all<{ tag: string }>();
    expect((tags.results ?? []).map((row) => row.tag)).toEqual(["1", "3"]);
  });

  test("GET /webhooks/on-message-received is 405", async () => {
    const response = await worker.fetch(
      new Request(
        "https://whatsmcp.unfld.dev/webhooks/on-message-received?token=webhook-secret-token",
      ),
      ENV,
      CTX,
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
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
