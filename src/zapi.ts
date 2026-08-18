import type { EndpointDef } from "./generated/endpoints";

export type ZapiMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface RawZapiRequest {
  method: ZapiMethod;
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
}

export class ZapiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ZapiError";
    this.status = status;
  }
}

function redactSecrets(text: string, env: Env): string {
  let out = text;
  for (const secret of [
    env.ZAPI_INSTANCE_ID,
    env.ZAPI_INSTANCE_TOKEN,
    env.ZAPI_CLIENT_TOKEN,
  ]) {
    if (secret) out = out.split(secret).join("[redacted]");
  }
  return out;
}

function instanceBase(env: Env): string {
  return `https://api.z-api.io/instances/${env.ZAPI_INSTANCE_ID}/token/${env.ZAPI_INSTANCE_TOKEN}`;
}

export function assertRelativePath(path: string): void {
  if (!path.startsWith("/")) {
    throw new Error("path must start with /");
  }
  if (path.includes("..")) {
    throw new Error("path must not contain '..'");
  }
  if (path.includes("://") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(path)) {
    throw new Error("path must be relative, not an absolute URL");
  }
}

function appendQuery(url: URL, query: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, String(item));
      }
      continue;
    }
    if (typeof value === "object") {
      url.searchParams.set(key, JSON.stringify(value));
      continue;
    }
    url.searchParams.set(key, String(value));
  }
}

export async function requestZapi(
  env: Env,
  request: RawZapiRequest,
): Promise<unknown> {
  assertRelativePath(request.path);

  const url = new URL(`${instanceBase(env)}${request.path}`);
  if (request.query) appendQuery(url, request.query);

  const init: RequestInit = {
    method: request.method,
    headers: {
      "Client-Token": env.ZAPI_CLIENT_TOKEN,
      "Content-Type": "application/json",
    },
  };

  if (request.method !== "GET" && request.body !== undefined) {
    init.body = JSON.stringify(request.body);
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ZapiError(0, redactSecrets(message, env));
  }

  const text = await response.text();
  const redacted = redactSecrets(text, env);

  if (!response.ok) {
    throw new ZapiError(
      response.status,
      `Z-API ${response.status}: ${redacted || response.statusText}`,
    );
  }

  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function bindEndpoint(
  endpoint: EndpointDef,
  args: Record<string, unknown>,
): { path: string; query: Record<string, unknown>; body: Record<string, unknown> } {
  const pathNames = new Set(endpoint.pathParams.map((param) => param.name));
  const queryNames = new Set(endpoint.queryParams);
  const bodyNames = new Set(endpoint.bodyParams);

  let path = endpoint.path;
  for (const { name, placeholder } of endpoint.pathParams) {
    const value = args[name];
    if (value === undefined || value === null || value === "") {
      throw new Error(`Missing path parameter: ${name}`);
    }
    path = path.replaceAll(placeholder, encodeURIComponent(String(value)));
  }

  const query: Record<string, unknown> = {};
  const body: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue;

    const inPath = pathNames.has(key);
    const inQuery = queryNames.has(key);
    const inBody = bodyNames.has(key);

    if (inQuery) query[key] = value;
    if (inBody) body[key] = value;
    if (inPath && !inQuery && !inBody) continue;
    if (inQuery || inBody) continue;

    if (endpoint.method === "GET") query[key] = value;
    else body[key] = value;
  }

  return { path, query, body };
}

export async function callZapi(
  env: Env,
  endpoint: EndpointDef,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { path, query, body } = bindEndpoint(endpoint, args);
  const hasQuery = Object.keys(query).length > 0;
  const hasBody = Object.keys(body).length > 0;

  return requestZapi(env, {
    method: endpoint.method,
    path,
    query: hasQuery ? query : undefined,
    body:
      endpoint.method === "GET" ? undefined : hasBody ? body : undefined,
  });
}
