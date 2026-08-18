import { afterEach, describe, expect, test } from "bun:test";
import { ENDPOINTS } from "./generated/endpoints";
import { callZapi, requestZapi, ZapiError } from "./zapi";

const originalFetch = globalThis.fetch;

const ENV: Env = {
  ZAPI_TOOLSETS: "*",
  MCP_AUTH_TOKEN: "test-mcp-token",
  ZAPI_INSTANCE_ID: "inst-secret-id",
  ZAPI_INSTANCE_TOKEN: "inst-secret-token",
  ZAPI_CLIENT_TOKEN: "client-secret-token",
  WEBHOOK_AUTH_TOKEN: "webhook-secret-token",
  DB: {} as D1Database,
};

function endpoint(name: string) {
  const found = ENDPOINTS.find((entry) => entry.name === name);
  if (!found) throw new Error(`missing endpoint ${name}`);
  return found;
}

function mockFetch(
  handler: (url: URL, init: RequestInit) => Response | Promise<Response>,
): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      input instanceof URL
        ? input
        : input instanceof Request
          ? new URL(input.url)
          : new URL(String(input));
    return handler(url, init ?? {});
  }) as typeof fetch;
}

function header(init: RequestInit, name: string): string | null {
  const headers = init.headers;
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    const row = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return row?.[1] ?? null;
  }
  const record = headers as Record<string, string>;
  return record[name] ?? record[name.toLowerCase()] ?? null;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("callZapi URL building", () => {
  test("substitutes path params (phoneNumber → {PHONE_NUMBER})", async () => {
    let seen: URL | undefined;
    mockFetch((url) => {
      seen = url;
      return Response.json({ ok: true });
    });

    await callZapi(ENV, endpoint("zapi_contacts_get_by_phone_number"), {
      phoneNumber: "554499999999",
    });

    expect(seen?.pathname).toBe(
      "/instances/inst-secret-id/token/inst-secret-token/contacts/554499999999",
    );
    expect(seen?.origin).toBe("https://api.z-api.io");
  });

  test("sends documented query params on GET and documented body params on POST", async () => {
    let getInit: RequestInit | undefined;
    let getUrl: URL | undefined;
    mockFetch((url, init) => {
      getUrl = url;
      getInit = init;
      return Response.json({ ok: true });
    });

    await callZapi(ENV, endpoint("zapi_chats_get"), { page: 1, pageSize: 20 });
    expect(getUrl?.searchParams.get("page")).toBe("1");
    expect(getUrl?.searchParams.get("pageSize")).toBe("20");
    expect(getInit?.body).toBeUndefined();

    let postInit: RequestInit | undefined;
    mockFetch((_url, init) => {
      postInit = init;
      return Response.json({ ok: true });
    });

    await callZapi(ENV, endpoint("zapi_messages_send_text"), {
      phone: "554499999999",
      message: "hello",
    });
    expect(JSON.parse(String(postInit?.body))).toEqual({
      phone: "554499999999",
      message: "hello",
    });
  });

  test("overlapping communityId goes to both path and body", async () => {
    let seenUrl: URL | undefined;
    let seenInit: RequestInit | undefined;
    mockFetch((url, init) => {
      seenUrl = url;
      seenInit = init;
      return Response.json({ ok: true });
    });

    await callZapi(ENV, endpoint("zapi_communities_redefine_invitation_link"), {
      communityId: "120363338093432331",
      groupsPhones: ["120363355575783097-group"],
    });

    expect(seenUrl?.pathname).toBe(
      "/instances/inst-secret-id/token/inst-secret-token/redefine-invitation-link/120363338093432331",
    );
    expect(JSON.parse(String(seenInit?.body))).toEqual({
      communityId: "120363338093432331",
      groupsPhones: ["120363355575783097-group"],
    });
  });

  test("GET never sends a body; extra keys go to the query string", async () => {
    let seenUrl: URL | undefined;
    let seenInit: RequestInit | undefined;
    mockFetch((url, init) => {
      seenUrl = url;
      seenInit = init;
      return Response.json({ ok: true });
    });

    await callZapi(ENV, endpoint("zapi_chats_get"), {
      page: 2,
      pageSize: 10,
      undocumented: "yes",
    });

    expect(seenUrl?.searchParams.get("page")).toBe("2");
    expect(seenUrl?.searchParams.get("pageSize")).toBe("10");
    expect(seenUrl?.searchParams.get("undocumented")).toBe("yes");
    expect(seenInit?.body).toBeUndefined();
  });

  test("extra keys on POST go to the body", async () => {
    let seenInit: RequestInit | undefined;
    mockFetch((_url, init) => {
      seenInit = init;
      return Response.json({ ok: true });
    });

    await callZapi(ENV, endpoint("zapi_messages_send_text"), {
      phone: "554499999999",
      message: "hello",
      undocumented: true,
    });

    expect(JSON.parse(String(seenInit?.body))).toEqual({
      phone: "554499999999",
      message: "hello",
      undocumented: true,
    });
  });

  test("sets the Client-Token header", async () => {
    let seenInit: RequestInit | undefined;
    mockFetch((_url, init) => {
      seenInit = init;
      return Response.json({ ok: true });
    });

    await requestZapi(ENV, { method: "GET", path: "/status" });
    expect(header(seenInit!, "Client-Token")).toBe("client-secret-token");
  });
});

describe("requestZapi path checks", () => {
  test("rejects paths that do not start with /", async () => {
    expect(() => requestZapi(ENV, { method: "GET", path: "status" })).toThrow(
      "path must start with /",
    );
  });

  test("rejects '..' in the path", async () => {
    expect(() => requestZapi(ENV, { method: "GET", path: "/foo/../status" })).toThrow(
      "path must not contain '..'",
    );
  });

  test("rejects absolute URLs", async () => {
    await expect(
      requestZapi(ENV, { method: "GET", path: "https://evil.example/status" }),
    ).rejects.toThrow("path must start with /");
    await expect(
      requestZapi(ENV, { method: "GET", path: "/https://evil.example/status" }),
    ).rejects.toThrow("path must be relative, not an absolute URL");
  });
});

describe("requestZapi errors", () => {
  test("non-2xx includes status and redacts instance id/token/client token", async () => {
    mockFetch(
      () =>
        new Response(
          `denied instance=${ENV.ZAPI_INSTANCE_ID} token=${ENV.ZAPI_INSTANCE_TOKEN} client=${ENV.ZAPI_CLIENT_TOKEN}`,
          { status: 403, statusText: "Forbidden" },
        ),
    );

    try {
      await requestZapi(ENV, { method: "GET", path: "/status" });
      throw new Error("expected ZapiError");
    } catch (error) {
      expect(error).toBeInstanceOf(ZapiError);
      const zapiError = error as ZapiError;
      expect(zapiError.status).toBe(403);
      expect(zapiError.message).toContain("403");
      expect(zapiError.message).not.toContain(ENV.ZAPI_INSTANCE_ID);
      expect(zapiError.message).not.toContain(ENV.ZAPI_INSTANCE_TOKEN);
      expect(zapiError.message).not.toContain(ENV.ZAPI_CLIENT_TOKEN);
      expect(zapiError.message).toContain("[redacted]");
    }
  });
});
