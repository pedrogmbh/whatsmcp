import { describe, expect, test } from "bun:test";
import { SERVER_INSTRUCTIONS } from "./server";

describe("MCP server instructions", () => {
  test("tell agents there is no message history", () => {
    expect(SERVER_INSTRUCTIONS).toContain("no get-messages");
    expect(SERVER_INSTRUCTIONS).toContain("whatsmcp_history_list");
    expect(SERVER_INSTRUCTIONS).toContain("zapi_messages_read_message");
  });
});
