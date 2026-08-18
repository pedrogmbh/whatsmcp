import { describe, expect, test } from "bun:test";
import {
  ftsQuery,
  getEvent,
  insertEvent,
  listEvents,
  normalizeEvent,
  searchEvents,
} from "./inbox";
import { parseChatSnapshot, parseTags, upsertChatSnapshot } from "./chats";
import { createMemoryD1, inboxTestSchema } from "./memory-d1";

const SCHEMA = await inboxTestSchema();

function db(): D1Database {
  return createMemoryD1(SCHEMA);
}

const TEXT_RECEIVED = {
  isStatusReply: false,
  senderLid: "81896604192873@lid",
  connectedPhone: "554499999999",
  waitingMessage: false,
  isEdit: false,
  isGroup: false,
  isNewsletter: false,
  instanceId: "A20DA9C0183A2D35A260F53F5D2B9244",
  messageId: "MSG-TEXT-1",
  phone: "5544999999999",
  fromMe: false,
  momment: 1632228638000,
  status: "RECEIVED",
  chatName: "Bacteria",
  senderPhoto: "https://",
  senderName: "Bacteria",
  participantPhone: null,
  participantLid: null,
  photo: "https://",
  broadcast: false,
  type: "ReceivedCallback",
  text: {
    message: "teste",
    description: "optional description",
  },
};

const IMAGE_RECEIVED = {
  ...TEXT_RECEIVED,
  messageId: "MSG-IMAGE-1",
  momment: 1632228828000,
  text: undefined,
  image: {
    mimeType: "image/jpeg",
    imageUrl: "https://example.com/photo.jpg",
    caption: "look at this",
    width: 600,
    height: 315,
  },
};

const STATUS_PAYLOAD = {
  instanceId: "instance.id",
  status: "READ",
  ids: ["MSG-TEXT-1"],
  momment: 1632234645000,
  phoneDevice: 0,
  phone: "5544999999999",
  type: "MessageStatusCallback",
  isGroup: false,
};

describe("normalizeEvent", () => {
  test("extracts text message fields from ReceivedCallback", () => {
    const event = normalizeEvent("received", TEXT_RECEIVED, 1);
    expect(event.kind).toBe("received");
    expect(event.messageId).toBe("MSG-TEXT-1");
    expect(event.phone).toBe("5544999999999");
    expect(event.chatName).toBe("Bacteria");
    expect(event.senderName).toBe("Bacteria");
    expect(event.fromMe).toBe(false);
    expect(event.isGroup).toBe(false);
    expect(event.isEdit).toBe(false);
    expect(event.eventType).toBe("ReceivedCallback");
    expect(event.messageKind).toBe("text");
    expect(event.status).toBe("RECEIVED");
    expect(event.moment).toBe(1632228638000);
    expect(event.text).toContain("teste");
    expect(event.payload).toContain("MSG-TEXT-1");
  });

  test("keeps messages sent by this number (fromMe)", () => {
    const event = normalizeEvent("received", {
      ...TEXT_RECEIVED,
      messageId: "MSG-FROM-ME",
      fromMe: true,
      text: { message: "I sent this" },
    });
    expect(event.kind).toBe("received");
    expect(event.fromMe).toBe(true);
    expect(event.text).toContain("I sent this");
  });

  test("extracts image caption and message kind", () => {
    const event = normalizeEvent("received", IMAGE_RECEIVED);
    expect(event.messageKind).toBe("image");
    expect(event.text).toContain("look at this");
  });

  test("uses the first status id as messageId", () => {
    const event = normalizeEvent("status", STATUS_PAYLOAD);
    expect(event.messageId).toBe("MSG-TEXT-1");
    expect(event.status).toBe("READ");
    expect(event.eventType).toBe("MessageStatusCallback");
    expect(event.text).toContain("READ");
  });
});

describe("ftsQuery", () => {
  test("builds prefix tokens and drops short noise", () => {
    expect(ftsQuery("hi Bacteria reply")).toBe(`"Bacteria"* AND "reply"*`);
    expect(ftsQuery("??")).toBeNull();
  });
});

describe("inbox D1", () => {
  test("inserts, lists by phone, and ignores retries", async () => {
    const d1 = db();
    const event = normalizeEvent("received", TEXT_RECEIVED, 10);
    expect((await insertEvent(d1, event)).inserted).toBe(true);
    expect((await insertEvent(d1, event)).inserted).toBe(false);

    const listed = await listEvents(d1, { phone: "5544999999999", kind: "received" });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.text).toContain("teste");
    expect(listed[0]?.id).toBeGreaterThan(0);
  });

  test("get by messageId and search via FTS", async () => {
    const d1 = db();
    await insertEvent(d1, normalizeEvent("received", TEXT_RECEIVED, 10));
    await insertEvent(d1, normalizeEvent("received", IMAGE_RECEIVED, 11));
    await insertEvent(d1, normalizeEvent("status", STATUS_PAYLOAD, 12));

    const byId = await getEvent(d1, { messageId: "MSG-TEXT-1" });
    expect(byId.map((row) => row.kind).sort()).toEqual(["received", "status"]);

    const hits = await searchEvents(d1, { query: "teste", kind: "received" });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.messageId).toBe("MSG-TEXT-1");

    const snapshot = parseChatSnapshot({
      phone: "5544999999999",
      tags: ["3"],
    });
    await upsertChatSnapshot(d1, snapshot!);
    const taggedHits = await searchEvents(d1, { query: "teste", tag: "3" });
    expect(taggedHits).toHaveLength(1);
    expect(await searchEvents(d1, { query: "teste", tag: "99" })).toHaveLength(0);
  });

  test("filters fromMe and since", async () => {
    const d1 = db();
    await insertEvent(d1, normalizeEvent("received", TEXT_RECEIVED, 10));
    await insertEvent(
      d1,
      normalizeEvent("received", { ...IMAGE_RECEIVED, fromMe: true }, 11),
    );

    const mine = await listEvents(d1, { fromMe: true });
    expect(mine).toHaveLength(1);
    expect(mine[0]?.messageId).toBe("MSG-IMAGE-1");

    const recent = await listEvents(d1, { since: 1632228800000 });
    expect(recent).toHaveLength(1);
    expect(recent[0]?.messageId).toBe("MSG-IMAGE-1");
  });

  test("filters history by chat tag snapshot", async () => {
    const d1 = db();
    await insertEvent(d1, normalizeEvent("received", TEXT_RECEIVED, 10));
    await insertEvent(
      d1,
      normalizeEvent(
        "received",
        { ...IMAGE_RECEIVED, phone: "5511999999999", messageId: "MSG-OTHER" },
        11,
      ),
    );

    const snapshot = parseChatSnapshot({
      phone: "5544999999999",
      name: "Bacteria",
      tags: ["1", 3],
    });
    expect(snapshot).not.toBeNull();
    await upsertChatSnapshot(d1, snapshot!);

    const tagged = await listEvents(d1, { tag: "3" });
    expect(tagged).toHaveLength(1);
    expect(tagged[0]?.messageId).toBe("MSG-TEXT-1");

    const empty = await listEvents(d1, { tag: "99" });
    expect(empty).toHaveLength(0);
  });
});

describe("parseTags", () => {
  test("coerces numeric ids and dedupes", () => {
    expect(parseTags(["1", 2, "2", " 3 ", "", null])).toEqual(["1", "2", "3"]);
    expect(parseTags(undefined)).toEqual([]);
  });
});
