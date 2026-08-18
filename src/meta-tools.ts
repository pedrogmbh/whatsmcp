import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ENDPOINTS } from "./generated/endpoints";
import { requestZapi, ZapiError } from "./zapi";

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

export function registerMetaTools(server: McpServer, env: Env): void {
  server.registerTool(
    "zapi_list_endpoints",
    {
      title: "List Z-API endpoints",
      description:
        "List every generated Z-API endpoint (name, category, method, path, summary), ignoring the ZAPI_TOOLSETS filter. Filter by exact category and/or a case-insensitive substring on name, summary, or path.",
      inputSchema: z.object({
        category: z.string().optional(),
        search: z.string().optional(),
      }),
    },
    async ({ category, search }) => {
      const needle = search?.toLowerCase();
      const matches = ENDPOINTS.filter((endpoint) => {
        if (category !== undefined && endpoint.category !== category) {
          return false;
        }
        if (!needle) return true;
        return (
          endpoint.name.toLowerCase().includes(needle) ||
          endpoint.summary.toLowerCase().includes(needle) ||
          endpoint.path.toLowerCase().includes(needle)
        );
      }).map(({ name, category: cat, method, path, summary }) => ({
        name,
        category: cat,
        method,
        path,
        summary,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(matches, null, 2) }],
      };
    },
  );

  server.registerTool(
    "zapi_describe_endpoint",
    {
      title: "Describe a Z-API endpoint",
      description:
        "Return the full generated EndpointDef for a tool name, including input schema, example description, docUrl, and variants.",
      inputSchema: z.object({
        name: z.string(),
      }),
    },
    async ({ name }) => {
      const endpoint = ENDPOINTS.find((entry) => entry.name === name);
      if (!endpoint) {
        return toolError(new Error(`Unknown endpoint: ${name}`));
      }
      return {
        content: [{ type: "text", text: JSON.stringify(endpoint, null, 2) }],
      };
    },
  );

  server.registerTool(
    "zapi_request",
    {
      title: "Raw Z-API request",
      description:
        "Escape hatch: call any path under this instance's Z-API base URL. Path must start with `/` and cannot be an absolute URL or contain `..`.",
      inputSchema: z.object({
        method: z.enum(["GET", "POST", "PUT", "DELETE"]),
        path: z.string(),
        query: z.record(z.string(), z.unknown()).optional(),
        body: z.unknown().optional(),
      }),
    },
    async ({ method, path, query, body }) => {
      try {
        const result = await requestZapi(env, { method, path, query, body });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
