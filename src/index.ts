import { isAuthorized, unauthorized } from "./auth";
import { servePublicIcon } from "./icon";
import { createHandler } from "./server";

const mcp = createHandler();

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json({ ok: true, name: "whatsmcp" });
    }

    const icon = await servePublicIcon(request);
    if (icon) return icon;

    if (url.pathname !== "/mcp") {
      return new Response("Not Found", { status: 404 });
    }

    if (!isAuthorized(request, env.MCP_AUTH_TOKEN)) {
      return unauthorized();
    }

    return mcp(request, env, ctx);
  },
};
