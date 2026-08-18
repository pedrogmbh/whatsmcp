function timingSafeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const len = Math.max(a.byteLength, b.byteLength);
  let mismatch = a.byteLength === b.byteLength ? 0 : 1;
  for (let i = 0; i < len; i++) {
    mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return mismatch === 0;
}

function presentedToken(header: string): string {
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : header;
}

/** Query `?token=` for Z-API webhooks (they cannot send Authorization). */
export function isWebhookAuthorized(
  url: URL,
  token: string | undefined,
): boolean {
  if (!token) return false;
  const presented = url.searchParams.get("token");
  if (presented === null) return false;
  return timingSafeEqual(presented, token);
}

/** Accepts `Authorization: <token>` and `Authorization: Bearer <token>`. */
export function isAuthorized(
  request: Request,
  token: string | undefined,
): boolean {
  if (!token) return false;
  const header = request.headers.get("Authorization");
  if (header === null) return false;
  return timingSafeEqual(presentedToken(header), token);
}

export function unauthorized(): Response {
  return Response.json(
    { error: "unauthorized" },
    {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    },
  );
}
