import { describe, expect, test } from "bun:test";
import { ENDPOINTS } from "./endpoints";

const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

const EXPECTED_PER_CATEGORY: Record<string, number> = {
  instance: 15,
  mobile: 14,
  messages: 34,
  privacy: 8,
  contacts: 7,
  chats: 4,
  calls: 1,
  groups: 15,
  communities: 8,
  newsletter: 17,
  status: 2,
  queue: 3,
  business: 27,
  webhooks: 7,
};

function byName(name: string) {
  const endpoint = ENDPOINTS.find((entry) => entry.name === name);
  expect(endpoint).toBeDefined();
  return endpoint!;
}

describe("generated ENDPOINTS", () => {
  test("has exactly 162 endpoints", () => {
    expect(ENDPOINTS).toHaveLength(162);
  });

  test("tool names are unique and MCP-safe", () => {
    const names = ENDPOINTS.map((endpoint) => endpoint.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(NAME_PATTERN);
    }
  });

  test("merges send-text variants into one tool", () => {
    const sendText = byName("zapi_messages_send_text");
    expect(sendText.method).toBe("POST");
    expect(sendText.path).toBe("/send-text");
    expect(sendText.variants).toHaveLength(3);
  });

  test("merges modify-chat into one tool with an action enum", () => {
    const modify = byName("zapi_chats_modify_chat");
    expect(modify.variants).toHaveLength(6);
    const action = (modify.inputSchema.properties as Record<string, { enum?: string[] }>)
      .action;
    expect(action?.enum).toEqual(["read", "archive", "pin", "mute", "clear", "delete"]);
  });

  test("resolves collection/path collisions with _by_<param>", () => {
    expect(byName("zapi_contacts_get").path).toBe("/contacts");
    expect(byName("zapi_contacts_get_by_phone_number").path).toBe("/contacts/{PHONE_NUMBER}");

    expect(byName("zapi_chats_get").path).toBe("/chats");
    expect(byName("zapi_chats_get_by_phone_number").path).toBe("/chats/{PHONE_NUMBER}");

    expect(byName("zapi_business_get_catalogs").path).toBe("/catalogs");
    expect(byName("zapi_business_get_catalogs_by_phone_number").path).toBe(
      "/catalogs/{PHONE_NUMBER}",
    );

    expect(byName("zapi_queue_delete").path).toBe("/queue");
    expect(byName("zapi_queue_delete_by_message_id").path).toBe("/queue/{MESSAGE_ID}");
  });

  test("excludes Partners endpoints", () => {
    for (const endpoint of ENDPOINTS) {
      expect(endpoint.category).not.toBe("partners");
      expect(endpoint.name.toLowerCase()).not.toContain("partner");
      expect(endpoint.path.toLowerCase()).not.toContain("partner");
    }
  });

  test("matches the expected per-category counts", () => {
    const counts: Record<string, number> = {};
    for (const endpoint of ENDPOINTS) {
      counts[endpoint.category] = (counts[endpoint.category] ?? 0) + 1;
    }
    expect(counts).toEqual(EXPECTED_PER_CATEGORY);
  });
});
