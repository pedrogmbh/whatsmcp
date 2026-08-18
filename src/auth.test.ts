import { describe, expect, test } from "bun:test";
import { isAuthorized, isWebhookAuthorized, unauthorized } from "./auth";

const TOKEN = "NOSCETEIPSUM";

function request(authorization?: string): Request {
  const headers = authorization === undefined ? undefined : { Authorization: authorization };
  return new Request("https://whatsmcp.unfld.dev/mcp", { headers });
}

describe("isAuthorized", () => {
  test("accepts a bare token", () => {
    expect(isAuthorized(request(TOKEN), TOKEN)).toBe(true);
  });

  test("accepts a Bearer token", () => {
    expect(isAuthorized(request(`Bearer ${TOKEN}`), TOKEN)).toBe(true);
  });

  test("rejects the wrong token", () => {
    expect(isAuthorized(request("WRONG"), TOKEN)).toBe(false);
    expect(isAuthorized(request("Bearer WRONG"), TOKEN)).toBe(false);
  });

  test("rejects a missing Authorization header", () => {
    expect(isAuthorized(request(), TOKEN)).toBe(false);
  });

  test("fails closed when MCP_AUTH_TOKEN is empty or unset", () => {
    expect(isAuthorized(request(TOKEN), "")).toBe(false);
    expect(isAuthorized(request(TOKEN), undefined)).toBe(false);
    expect(isAuthorized(request(`Bearer ${TOKEN}`), "")).toBe(false);
  });
});

describe("isWebhookAuthorized", () => {
  test("accepts a matching token query param", () => {
    expect(
      isWebhookAuthorized(
        new URL("https://whatsmcp.unfld.dev/webhooks/on-message-received?token=secret"),
        "secret",
      ),
    ).toBe(true);
  });

  test("rejects a missing, wrong, or unset token", () => {
    const url = new URL("https://whatsmcp.unfld.dev/webhooks/on-message-received?token=nope");
    expect(isWebhookAuthorized(url, "secret")).toBe(false);
    expect(
      isWebhookAuthorized(
        new URL("https://whatsmcp.unfld.dev/webhooks/on-message-received"),
        "secret",
      ),
    ).toBe(false);
    expect(
      isWebhookAuthorized(
        new URL("https://whatsmcp.unfld.dev/webhooks/on-message-received?token=secret"),
        undefined,
      ),
    ).toBe(false);
  });
});

describe("unauthorized", () => {
  test("returns 401 with WWW-Authenticate: Bearer", async () => {
    const response = unauthorized();
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(await response.json() as { error: string }).toEqual({ error: "unauthorized" });
  });
});
