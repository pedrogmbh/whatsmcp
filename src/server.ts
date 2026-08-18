import { fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/server/validators/cf-worker";
import { createMcpHandler } from "agents/mcp/server";
import { ENDPOINTS } from "./generated/endpoints";
import { PUBLIC_ORIGIN, SERVER_ICONS } from "./icon";
import { registerMetaTools } from "./meta-tools";
import { callZapi, ZapiError } from "./zapi";

const validator = new CfWorkerJsonSchemaValidator();

const HANDLER_OPTIONS = {
  route: "/mcp",
  allowedHostnames: ["whatsmcp.unfld.dev", "localhost", "127.0.0.1"],
  corsOptions: false as const,
};

function selectedCategories(raw: string | undefined): Set<string> | "all" {
  const parts = (raw ?? "*")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (parts.includes("*")) return "all";
  return new Set(parts);
}

function toolError(error: unknown): {
  isError: true;
  content: [{ type: "text"; text: string }];
} {
  const text =
    error instanceof ZapiError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
  return { isError: true, content: [{ type: "text", text }] };
}

export function createServer(env: Env): McpServer {
  const server = new McpServer({
    name: "whatsmcp",
    title: "WhatsMCP",
    description: "Z-API WhatsApp MCP server",
    version: "1.0.0",
    websiteUrl: PUBLIC_ORIGIN,
    icons: SERVER_ICONS,
  });

  const filter = selectedCategories(env.ZAPI_TOOLSETS);
  const endpoints =
    filter === "all"
      ? ENDPOINTS
      : ENDPOINTS.filter((endpoint) => filter.has(endpoint.category));

  for (const endpoint of endpoints) {
    server.registerTool(
      endpoint.name,
      {
        title: endpoint.summary,
        description: endpoint.description,
        inputSchema: fromJsonSchema(endpoint.inputSchema, validator),
      },
      async (args) => {
        try {
          const result = await callZapi(
            env,
            endpoint,
            (args ?? {}) as Record<string, unknown>,
          );
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return toolError(error);
        }
      },
    );
  }

  registerMetaTools(server, env);
  return server;
}

export function createHandler() {
  const handlers = new WeakMap<Env, ReturnType<typeof createMcpHandler>>();

  return (request: Request, env: Env, ctx: ExecutionContext) => {
    let handler = handlers.get(env);
    if (!handler) {
      handler = createMcpHandler(() => createServer(env), HANDLER_OPTIONS);
      handlers.set(env, handler);
    }
    return handler(request, env, ctx);
  };
}
