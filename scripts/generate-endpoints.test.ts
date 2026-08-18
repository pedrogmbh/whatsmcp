import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { lenientParse } from "./generate-endpoints";

const COLLECTION_PATH = resolve(import.meta.dir, "../postman.json");

const SEND_TEXT_BODY = `{
    "phone": "554499999999",
    "message": "Testando mensagem teste",

    // Parâmetros opcionais:
    "delayMessage": 15
    // "delayTyping": 0
    // "editMessageId": ""
}`;

interface PostmanItem {
  name?: string;
  item?: PostmanItem[];
  request?: {
    body?: { mode?: string; raw?: string };
  };
}

/** Non-empty raw bodies under every folder except Partners, matching the generator. */
function collectRawBodies(items: PostmanItem[], trail: string[] = []): string[] {
  const bodies: string[] = [];
  for (const item of items) {
    if (item.item) {
      bodies.push(...collectRawBodies(item.item, [...trail, item.name ?? ""]));
      continue;
    }
    if ((trail[0] ?? "") === "Partners") continue;
    const raw = item.request?.body?.mode === "raw" ? (item.request.body.raw ?? "").trim() : "";
    if (raw) bodies.push(raw);
  }
  return bodies;
}

describe("lenientParse", () => {
  test("keeps // that appears inside a string value", () => {
    const raw = `{
      "value": "https://app.z-api.io/logos/zapi-dark.png",
      "note": "see // not a comment"
    }`;
    const { obj, commented } = lenientParse(raw);
    expect(obj.value).toBe("https://app.z-api.io/logos/zapi-dark.png");
    expect(obj.note).toBe("see // not a comment");
    expect(commented.size).toBe(0);
  });

  test("collects // \"delayMessage\": 5 as a commented optional key", () => {
    const { obj, commented } = lenientParse(`{
      "phone": "554499999999",
      // "delayMessage": 5
    }`);
    expect(obj).toEqual({ phone: "554499999999" });
    expect(commented.get("delayMessage")).toBe(5);
    expect(obj).not.toHaveProperty("delayMessage");
  });

  test("accepts trailing commas in objects and arrays", () => {
    const { obj } = lenientParse(`{
      "phone": "554499999999",
      "mentioned": ["554411111111", "554422222222",],
    }`);
    expect(obj.phone).toBe("554499999999");
    expect(obj.mentioned).toEqual(["554411111111", "554422222222"]);
  });

  test("parses the real send-text Postman body (active keys + commented optionals)", () => {
    const { obj, commented } = lenientParse(SEND_TEXT_BODY);
    expect(obj).toEqual({
      phone: "554499999999",
      message: "Testando mensagem teste",
      delayMessage: 15,
    });
    expect(commented.get("delayTyping")).toBe(0);
    expect(commented.get("editMessageId")).toBe("");
    expect(obj).not.toHaveProperty("delayTyping");
    expect(obj).not.toHaveProperty("editMessageId");
  });

  test("parses all 129 non-empty raw bodies in the collection", async () => {
    const collection = JSON.parse(await Bun.file(COLLECTION_PATH).text()) as {
      item?: PostmanItem[];
    };
    const bodies = collectRawBodies(collection.item ?? []);
    expect(bodies).toHaveLength(129);

    const failures: string[] = [];
    for (const [index, raw] of bodies.entries()) {
      try {
        const { obj } = lenientParse(raw);
        expect(obj).toBeTypeOf("object");
        expect(obj).not.toBeNull();
      } catch (error) {
        failures.push(`body ${index}: ${(error as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
