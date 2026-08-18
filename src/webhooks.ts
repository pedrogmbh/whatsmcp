import { isWebhookAuthorized, unauthorized } from "./auth";
import { insertEvent, normalizeEvent, WEBHOOK_PATHS } from "./inbox";

export async function handleWebhook(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  const kind = WEBHOOK_PATHS[url.pathname];
  if (kind === undefined) return null;

  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }

  if (!isWebhookAuthorized(url, env.WEBHOOK_AUTH_TOKEN)) {
    return unauthorized();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  await insertEvent(
    env.DB,
    normalizeEvent(kind, body as Record<string, unknown>),
  );
  return Response.json({ ok: true });
}
