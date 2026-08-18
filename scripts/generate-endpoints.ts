#!/usr/bin/env bun
/**
 * Generates `src/generated/endpoints.ts` from the Z-API Postman collection.
 *
 *   bun run scripts/generate-endpoints.ts
 *
 * The collection is the only source that carries real parameter names — the
 * published Z-API docs strip `name` and `required` off every <ParamField>.
 *
 * The generator is intentionally paranoid: every count it depends on is
 * asserted, and any residual tool-name collision aborts the run rather than
 * silently dropping an endpoint.
 */

import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const COLLECTION_PATH = resolve(ROOT, "postman-collection-z-api.json");
const OUTPUT_PATH = resolve(ROOT, "src/generated/endpoints.ts");

/** Every non-Partners request is built on top of this literal prefix. */
const URL_PREFIX = "{{BASE_URL}}/instances/{{INSTANCE_ID}}/token/{{INSTANCE_TOKEN}}";

/** Partners endpoints use a Bearer partner token and can create billable instances. */
const EXCLUDED_FOLDERS = new Set(["Partners"]);

const CATEGORY_BY_FOLDER: Record<string, string> = {
  Instance: "instance",
  Mobile: "mobile",
  Messages: "messages",
  Privacy: "privacy",
  Contacts: "contacts",
  Chats: "chats",
  Calls: "calls",
  Groups: "groups",
  Communities: "communities",
  Newsletter: "newsletter",
  Status: "status",
  "Message queue": "queue",
  "WhatsApp Business": "business",
  Webhooks: "webhooks",
};

const EXPECTED_TOTAL = 162;

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

const EXPECTED_BODY_COUNT = 129;

/**
 * Two collection URLs bake an example value into a segment the API treats as a
 * variable. Left literal they would produce tools that can only ever hit one
 * message / one file extension.
 */
const PATH_REWRITES: { from: string; to: string; note: string }[] = [
  {
    from: "/queue/3D79E55771D6A0C97D3562CCDB50DFDB",
    to: "/queue/{MESSAGE_ID}",
    note: "The Postman collection hardcodes an example message id in this path; it is parameterised here.",
  },
  {
    from: "/send-document/mp4",
    to: "/send-document/{EXTENSION}",
    note: "The last path segment is the document's file extension (pdf, docx, mp4, ...), as documented by Z-API.",
  },
];

const PATH_PARAM_DOCS: Record<string, string> = {
  PHONE_NUMBER:
    "Phone in international format: country code + area code + number, digits only (e.g. 554499999999).",
  GROUP_PHONE_NUMBER: "Group id / group phone (e.g. 120363356737170752-group).",
  COMMUNITY_ID: "Community id (e.g. 120363338093432331).",
  NEWSLETTER_ID: "Newsletter (channel) id (e.g. 120363336258908380@newsletter).",
  PRODUCT_ID: "Catalog product id.",
  TAG_ID: "Business tag (etiqueta) id.",
  COLLECTION_ID: "Catalog collection id.",
  MESSAGE_ID: "Id of the queued message.",
  EXTENSION: "File extension of the document being sent (pdf, docx, xlsx, mp4, ...).",
};

/**
 * Verbs that already appear at the start of a Z-API path. When the path starts
 * with one of these the generated name does not get a synthetic method prefix,
 * so `PUT /update-call-reject-auto` stays `..._update_call_reject_auto`.
 */
const PATH_VERBS = new Set([
  "accept",
  "add",
  "approve",
  "create",
  "delete",
  "disconnect",
  "follow",
  "forward",
  "leave",
  "modify",
  "mute",
  "order",
  "pin",
  "read",
  "redefine",
  "remove",
  "restart",
  "revoke",
  "search",
  "send",
  "transfer",
  "unfollow",
  "unmute",
  "update",
]);

/** Synthetic prefix applied when the path does not already start with a verb. */
const METHOD_VERB: Record<string, string> = { GET: "get", PUT: "set", DELETE: "delete", POST: "" };

/** Used when the whole path collapses away (e.g. `GET /contacts` in category `contacts`). */
const BARE_METHOD_VERB: Record<string, string> = {
  GET: "get",
  PUT: "update",
  DELETE: "delete",
  POST: "create",
};

/**
 * Doc links, keyed by `METHOD <instance-relative path>`.
 *
 * Derived once from the `Source:` headers in the official docs dump
 * (llms-full.txt) by matching method + path; the collection itself carries no
 * doc URLs. Endpoints absent from this table (queue, webhooks) have no
 * published page in that dump and deliberately get no `docUrl`.
 */
const DOC_URLS = new Map<string, string>([
  ["PUT /profile-name", "https://developer.z-api.io/instance/profile-name"],
  ["PUT /profile-picture", "https://developer.z-api.io/instance/profile-picture"],
  ["PUT /profile-description", "https://developer.z-api.io/instance/profile-description"],
  ["PUT /update-call-reject-auto", "https://developer.z-api.io/instance/update-call-reject-auto"],
  ["PUT /update-call-reject-message", "https://developer.z-api.io/instance/update-call-reject-message"],
  ["GET /qr-code", "https://developer.z-api.io/instance/qr-code"],
  ["GET /qr-code/image", "https://developer.z-api.io/instance/qr-code-image"],
  ["GET /phone-code/{PHONE_NUMBER}", "https://developer.z-api.io/instance/phone-code"],
  ["GET /restart", "https://developer.z-api.io/instance/restart"],
  ["GET /disconnect", "https://developer.z-api.io/instance/disconnect"],
  ["GET /status", "https://developer.z-api.io/instance/status"],
  ["PUT /update-name", "https://developer.z-api.io/instance/rename-instance"],
  ["GET /me", "https://developer.z-api.io/instance/me"],
  ["PUT /update-auto-read-message", "https://developer.z-api.io/instance/update-auto-read-message"],
  ["GET /device", "https://developer.z-api.io/instance/device"],
  ["POST /mobile/registration-available", "https://developer.z-api.io/mobile/registration-available"],
  ["POST /mobile/request-registration-code", "https://developer.z-api.io/mobile/request-code"],
  ["POST /mobile/respond-captcha", "https://developer.z-api.io/mobile/captcha-confirm"],
  ["POST /mobile/confirm-registration-code", "https://developer.z-api.io/mobile/confirm-code"],
  ["POST /mobile/confirm-pin-code", "https://developer.z-api.io/mobile/confirm-security-code"],
  ["POST /mobile/recover-pin-code", "https://developer.z-api.io/mobile/forgot-security-code"],
  ["GET /security/two-fa-code", "https://developer.z-api.io/mobile/get-has-security-code"],
  ["POST /security/two-fa-code", "https://developer.z-api.io/mobile/set-security-code"],
  ["POST /security/two-fa-code/remove", "https://developer.z-api.io/mobile/remove-security-code"],
  ["GET /security/email", "https://developer.z-api.io/mobile/get-account-email"],
  ["POST /security/email", "https://developer.z-api.io/mobile/set-account-email"],
  ["POST /security/verify-email", "https://developer.z-api.io/mobile/verify-account-email"],
  ["POST /security/email/remove", "https://developer.z-api.io/mobile/remove-account-email"],
  ["POST /mobile/request-unbanning", "https://developer.z-api.io/mobile/request-unbanning"],
  ["POST /send-text", "https://developer.z-api.io/message/send-text"],
  ["POST /forward-message", "https://developer.z-api.io/message/forward-message"],
  ["POST /send-reaction", "https://developer.z-api.io/message/send-message-reaction"],
  ["POST /send-remove-reaction", "https://developer.z-api.io/message/send-remove-reaction"],
  ["POST /send-image", "https://developer.z-api.io/message/send-message-image"],
  ["POST /send-sticker", "https://developer.z-api.io/message/send-message-sticker"],
  ["POST /send-gif", "https://developer.z-api.io/message/send-message-gif"],
  ["POST /send-audio", "https://developer.z-api.io/message/send-message-audio"],
  ["POST /send-video", "https://developer.z-api.io/message/send-message-video"],
  ["POST /send-ptv", "https://developer.z-api.io/message/send-message-ptv"],
  ["POST /send-document/{EXTENSION}", "https://developer.z-api.io/message/send-message-document"],
  ["POST /send-link", "https://developer.z-api.io/message/send-message-link"],
  ["POST /send-location", "https://developer.z-api.io/message/send-message-location"],
  ["POST /send-product", "https://developer.z-api.io/message/send-message-product"],
  ["POST /send-catalog", "https://developer.z-api.io/message/send-message-catalog"],
  ["POST /send-contact", "https://developer.z-api.io/message/send-message-contact"],
  ["POST /send-contacts", "https://developer.z-api.io/message/send-message-multiple-contacts"],
  ["POST /send-button-actions", "https://developer.z-api.io/message/send-button-actions"],
  ["POST /send-button-list", "https://developer.z-api.io/message/send-button-list"],
  ["POST /send-option-list", "https://developer.z-api.io/message/send-option-list"],
  ["POST /send-button-otp", "https://developer.z-api.io/message/send-button-otp"],
  ["POST /send-button-pix", "https://developer.z-api.io/message/send-button-pix"],
  ["DELETE /messages", "https://developer.z-api.io/message/delete-message"],
  ["POST /read-message", "https://developer.z-api.io/message/read-message"],
  ["POST /send-poll", "https://developer.z-api.io/message/send-poll"],
  ["POST /send-poll-vote", "https://developer.z-api.io/message/send-poll-vote"],
  ["POST /send-order", "https://developer.z-api.io/message/send-message-order"],
  ["POST /order-status-update", "https://developer.z-api.io/message/send-order-status-update"],
  ["POST /order-payment-update", "https://developer.z-api.io/message/send-order-payment-update"],
  ["POST /pin-message", "https://developer.z-api.io/message/send-pin-message"],
  ["POST /send-newsletter-admin-invite", "https://developer.z-api.io/message/send-newsletter-admin-invite"],
  ["POST /send-event", "https://developer.z-api.io/message/send-event"],
  ["POST /send-edit-event", "https://developer.z-api.io/message/send-edit-event"],
  ["POST /send-event-response", "https://developer.z-api.io/message/send-event-response"],
  ["GET /privacy/disallowed-contacts", "https://developer.z-api.io/privacy/get-disallowed-contacts"],
  ["POST /privacy/last-seen", "https://developer.z-api.io/privacy/set-last-seen"],
  ["POST /privacy/photo", "https://developer.z-api.io/privacy/set-photo-visualization"],
  ["POST /privacy/description", "https://developer.z-api.io/privacy/set-privacy-description"],
  ["POST /privacy/group-add", "https://developer.z-api.io/privacy/set-group-add-permission"],
  ["POST /privacy/online", "https://developer.z-api.io/privacy/set-privacy-online"],
  ["POST /privacy/read-receipts", "https://developer.z-api.io/privacy/set-read-receipts"],
  ["POST /privacy/messages-duration", "https://developer.z-api.io/privacy/set-messages-duration"],
  ["GET /contacts", "https://developer.z-api.io/contacts/get-contacts"],
  ["GET /contacts/{PHONE_NUMBER}", "https://developer.z-api.io/contacts/get-metadata-contact"],
  ["GET /profile-picture", "https://developer.z-api.io/contacts/get-profile-picture"],
  ["GET /phone-exists/{PHONE_NUMBER}", "https://developer.z-api.io/contacts/get-iswhatsapp"],
  ["POST /phone-exists-batch", "https://developer.z-api.io/contacts/get-iswhatsapp-batch"],
  ["POST /contacts/modify-blocked", "https://developer.z-api.io/contacts/block-contact"],
  ["POST /contacts/{PHONE_NUMBER}/report", "https://developer.z-api.io/contacts/report-contact"],
  ["GET /chats", "https://developer.z-api.io/chats/get-chats"],
  ["GET /chats/{PHONE_NUMBER}", "https://developer.z-api.io/chats/get-metadata-chat"],
  ["POST /modify-chat", "https://developer.z-api.io/chats/archive-chat"],
  ["POST /send-chat-expiration", "https://developer.z-api.io/chats/send-chat-expiration"],
  ["POST /send-call", "https://developer.z-api.io/calls/send-call"],
  ["POST /create-group", "https://developer.z-api.io/group/create-group"],
  ["POST /update-group-name", "https://developer.z-api.io/group/update-group-name"],
  ["POST /update-group-photo", "https://developer.z-api.io/group/update-group-photo"],
  ["POST /add-participant", "https://developer.z-api.io/group/add-participant"],
  ["POST /remove-participant", "https://developer.z-api.io/group/remove-participant"],
  ["POST /approve-participant", "https://developer.z-api.io/group/approve-participant"],
  ["POST /add-admin", "https://developer.z-api.io/group/add-admin"],
  ["POST /remove-admin", "https://developer.z-api.io/group/remove-admin"],
  ["POST /leave-group", "https://developer.z-api.io/group/leave-group"],
  ["GET /group-metadata/{GROUP_PHONE_NUMBER}", "https://developer.z-api.io/group/metadata-group"],
  ["GET /group-invitation-metadata", "https://developer.z-api.io/group/group-invitation-metadata"],
  ["POST /update-group-settings", "https://developer.z-api.io/group/update-group-settings"],
  ["POST /update-group-description", "https://developer.z-api.io/group/update-group-description"],
  [
    "POST /redefine-invitation-link/{GROUP_PHONE_NUMBER}",
    "https://developer.z-api.io/group/redefine-invitation-link",
  ],
  ["GET /accept-invite-group", "https://developer.z-api.io/group/accept-group-invite"],
  ["POST /communities", "https://developer.z-api.io/communities/create-community"],
  ["GET /communities", "https://developer.z-api.io/communities/list-communities"],
  ["POST /communities/link", "https://developer.z-api.io/communities/link-groups"],
  ["POST /communities/unlink", "https://developer.z-api.io/communities/unlink-groups"],
  ["GET /communities-metadata/{COMMUNITY_ID}", "https://developer.z-api.io/communities/community-metadata"],
  [
    "POST /redefine-invitation-link/{COMMUNITY_ID}",
    "https://developer.z-api.io/communities/redefine-invitation-link",
  ],
  ["POST /communities/settings", "https://developer.z-api.io/communities/community-settings"],
  ["DELETE /communities/{COMMUNITY_ID}", "https://developer.z-api.io/communities/deactivate-community"],
  ["POST /create-newsletter", "https://developer.z-api.io/newsletter/create-newsletter"],
  ["POST /update-newsletter-picture", "https://developer.z-api.io/newsletter/update-newsletter-picture"],
  ["POST /update-newsletter-name", "https://developer.z-api.io/newsletter/update-newsletter-name"],
  [
    "POST /update-newsletter-description",
    "https://developer.z-api.io/newsletter/update-newsletter-description",
  ],
  ["PUT /follow-newsletter", "https://developer.z-api.io/newsletter/follow-newsletter"],
  ["PUT /unfollow-newsletter", "https://developer.z-api.io/newsletter/unfollow-newsletter"],
  ["PUT /mute-newsletter", "https://developer.z-api.io/newsletter/mute-newsletter"],
  ["PUT /unmute-newsletter", "https://developer.z-api.io/newsletter/unmute-newsletter"],
  ["DELETE /delete-newsletter", "https://developer.z-api.io/newsletter/delete-newsletter"],
  ["GET /newsletter/metadata/{NEWSLETTER_ID}", "https://developer.z-api.io/newsletter/newsletter-metadata"],
  ["GET /newsletter", "https://developer.z-api.io/newsletter/newsletter-list"],
  ["POST /search-newsletter", "https://developer.z-api.io/newsletter/search-newsletter"],
  [
    "POST /newsletter/settings/{NEWSLETTER_ID}",
    "https://developer.z-api.io/newsletter/update-newsletter-config",
  ],
  [
    "POST /newsletter/accept-admin-invite/{NEWSLETTER_ID}",
    "https://developer.z-api.io/newsletter/accept-newsletter-admin-invite",
  ],
  [
    "POST /newsletter/remove-admin/{NEWSLETTER_ID}",
    "https://developer.z-api.io/newsletter/newsletter-remove-admin",
  ],
  [
    "POST /newsletter/revoke-admin-invite/{NEWSLETTER_ID}",
    "https://developer.z-api.io/newsletter/newsletter-revoke-admin-invite",
  ],
  [
    "POST /newsletter/transfer-ownership/{NEWSLETTER_ID}",
    "https://developer.z-api.io/newsletter/transfer-newsletter-ownership",
  ],
  ["POST /send-text-status", "https://developer.z-api.io/status/send-text-status"],
  ["POST /send-image-status", "https://developer.z-api.io/status/send-image-status"],
  ["POST /products", "https://developer.z-api.io/business/edit-product"],
  ["GET /catalogs", "https://developer.z-api.io/business/get-products"],
  ["GET /catalogs/{PHONE_NUMBER}", "https://developer.z-api.io/business/get-products-phone"],
  ["GET /products/{PRODUCT_ID}", "https://developer.z-api.io/business/get-product-id"],
  ["DELETE /products/{PRODUCT_ID}", "https://developer.z-api.io/business/delete-product"],
  ["GET /tags", "https://developer.z-api.io/business/tags"],
  ["GET /business/tags/colors", "https://developer.z-api.io/business/tags-colors"],
  ["POST /business/create-tag", "https://developer.z-api.io/business/create-tag"],
  ["POST /business/edit-tag/{TAG_ID}", "https://developer.z-api.io/business/edit-tag"],
  ["DELETE /business/tag/{TAG_ID}", "https://developer.z-api.io/business/delete-tag"],
  ["PUT /chats/{PHONE_NUMBER}/tags/{TAG_ID}/add", "https://developer.z-api.io/business/tags-add"],
  ["PUT /chats/{PHONE_NUMBER}/tags/{TAG_ID}/remove", "https://developer.z-api.io/business/tags-remove"],
  ["POST /catalogs/config", "https://developer.z-api.io/business/save-catalog-config"],
  ["POST /catalogs/collection", "https://developer.z-api.io/business/create-collection"],
  ["GET /catalogs/collection", "https://developer.z-api.io/business/list-collections"],
  ["DELETE /catalogs/collection/{COLLECTION_ID}", "https://developer.z-api.io/business/delete-collection"],
  ["POST /catalogs/collection-edit/{COLLECTION_ID}", "https://developer.z-api.io/business/edit-collection"],
  [
    "GET /catalogs/collection-products/{PHONE_NUMBER}",
    "https://developer.z-api.io/business/list-collection-products",
  ],
  [
    "POST /catalogs/collection/add-product",
    "https://developer.z-api.io/business/add-product-to-collection",
  ],
  [
    "POST /catalogs/collection/remove-product",
    "https://developer.z-api.io/business/remove-product-from-collection",
  ],
  ["POST /business/company-description", "https://developer.z-api.io/business/company-description"],
  ["POST /business/company-email", "https://developer.z-api.io/business/company-email"],
  ["POST /business/company-address", "https://developer.z-api.io/business/company-address"],
  ["POST /business/company-websites", "https://developer.z-api.io/business/company-websites"],
  ["POST /business/hours", "https://developer.z-api.io/business/business-hours"],
  ["GET /business/available-categories", "https://developer.z-api.io/business/available-categories"],
  ["POST /business/categories", "https://developer.z-api.io/business/company-categories"],
]);

// ---------------------------------------------------------------------------
// Postman shapes (only what we read)
// ---------------------------------------------------------------------------

interface PostmanQuery {
  key?: string;
  value?: string;
  description?: string;
  disabled?: boolean;
}

interface PostmanUrl {
  raw?: string;
  query?: PostmanQuery[];
}

interface PostmanRequest {
  method?: string;
  description?: string;
  url?: string | PostmanUrl;
  body?: { mode?: string; raw?: string };
}

interface PostmanItem {
  name?: string;
  item?: PostmanItem[];
  request?: PostmanRequest;
}

interface FlatRequest {
  name: string;
  folder: string;
  category: string;
  method: string;
  path: string;
  description: string;
  rawBody: string;
  /**
   * Three GET requests carry a copy-pasted body left over from a neighbouring
   * request (verified against the docs); a GET never sends one.
   */
  bodyIsReal: boolean;
  query: PostmanQuery[];
}

type Schema = Record<string, unknown>;

interface Param {
  name: string;
  schema: Schema;
  required: boolean;
}

// ---------------------------------------------------------------------------
// JSONC body parsing
// ---------------------------------------------------------------------------

/**
 * String-aware JSONC scanner.
 *
 * The collection marks optional parameters by commenting them out under a
 * `// Parâmetros opcionais:` header, so the commented keys carry real schema
 * information and must be collected rather than discarded. A regex stripper
 * cannot be used: `//` also occurs inside string values such as
 * `"https://app.z-api.io/logos/zapi-dark.png"`.
 */
export function lenientParse(raw: string): {
  obj: Record<string, unknown>;
  commented: Map<string, unknown>;
} {
  const commented = new Map<string, unknown>();
  let out = "";
  let i = 0;
  let inStr = false;
  let esc = false;

  while (i < raw.length) {
    const ch = raw[i]!;

    if (inStr) {
      out += ch;
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      i++;
      continue;
    }

    if (ch === '"') {
      inStr = true;
      out += ch;
      i++;
      continue;
    }

    if (ch === "/" && raw[i + 1] === "/") {
      let j = raw.indexOf("\n", i);
      if (j < 0) j = raw.length;
      const line = raw.slice(i + 2, j);
      const m = line.match(/^\s*"([A-Za-z0-9_]+)"\s*:\s*(.*?)\s*,?\s*$/);
      if (m) commented.set(m[1]!, parseExample(m[2]!));
      i = j;
      continue;
    }

    if (ch === "/" && raw[i + 1] === "*") {
      const j = raw.indexOf("*/", i);
      i = j < 0 ? raw.length : j + 2;
      continue;
    }

    out += ch;
    i++;
  }

  out = out.replace(/,(\s*[}\]])/g, "$1");
  return { obj: JSON.parse(out) as Record<string, unknown>, commented };
}

/** Best-effort value for a commented-out key; `undefined` when it is not parseable. */
function parseExample(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// JSON Schema inference
// ---------------------------------------------------------------------------

/** Nested shapes are described a couple of levels deep and stay permissive below that. */
const MAX_DEPTH = 3;

function inferSchema(value: unknown, depth = 0): Schema {
  if (value === null || value === undefined) return {};
  if (typeof value === "string") return { type: "string" };
  if (typeof value === "boolean") return { type: "boolean" };
  if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number" };

  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH || value.length === 0) return { type: "array" };
    let items = inferSchema(value[0], depth + 1);
    for (const element of value.slice(1)) items = mergeSchemas(items, inferSchema(element, depth + 1));
    return { type: "array", items };
  }

  if (typeof value === "object") {
    if (depth >= MAX_DEPTH) return { type: "object", additionalProperties: true };
    const properties: Record<string, Schema> = {};
    for (const [key, nested] of Object.entries(value)) {
      properties[key] = inferSchema(nested, depth + 1);
    }
    return Object.keys(properties).length
      ? { type: "object", properties, additionalProperties: true }
      : { type: "object", additionalProperties: true };
  }

  return {};
}

/** Widens two inferred schemas into one that accepts both. */
function mergeSchemas(a: Schema, b: Schema): Schema {
  if (JSON.stringify(a) === JSON.stringify(b)) return a;

  const description = (a.description ?? b.description) as string | undefined;
  const withDescription = (schema: Schema): Schema =>
    description === undefined ? schema : { ...schema, description };

  const aType = a.type as string | undefined;
  const bType = b.type as string | undefined;

  if (aType === undefined || bType === undefined) return withDescription({});

  if (aType !== bType) {
    if ((aType === "integer" && bType === "number") || (aType === "number" && bType === "integer")) {
      return withDescription({ type: "number" });
    }
    return withDescription({});
  }

  if (aType === "object") {
    const aProps = (a.properties ?? {}) as Record<string, Schema>;
    const bProps = (b.properties ?? {}) as Record<string, Schema>;
    const properties: Record<string, Schema> = {};
    for (const key of new Set([...Object.keys(aProps), ...Object.keys(bProps)])) {
      const left = aProps[key];
      const right = bProps[key];
      properties[key] = left && right ? mergeSchemas(left, right) : (left ?? right ?? {});
    }
    return Object.keys(properties).length
      ? withDescription({ type: "object", properties, additionalProperties: true })
      : withDescription({ type: "object", additionalProperties: true });
  }

  if (aType === "array") {
    const aItems = a.items as Schema | undefined;
    const bItems = b.items as Schema | undefined;
    if (aItems && bItems) return withDescription({ type: "array", items: mergeSchemas(aItems, bItems) });
    return withDescription({ type: "array" });
  }

  return withDescription({ type: aType });
}

/** Query values arrive as strings; only unambiguous scalars are narrowed. */
function inferQuerySchema(value: string | undefined): Schema {
  if (value === "true" || value === "false") return { type: "boolean" };
  if (value !== undefined && /^\d{1,4}$/.test(value)) return { type: "integer" };
  return { type: "string" };
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const PLACEHOLDER_PATTERN = /^\{[A-Z0-9_]+\}$/;

function camelCase(placeholder: string): string {
  return placeholder
    .replace(/[{}]/g, "")
    .toLowerCase()
    .replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function snakeCase(placeholder: string): string {
  return placeholder.replace(/[{}]/g, "").toLowerCase();
}

function baseName(category: string, method: string, path: string): string {
  let segments = path
    .split("/")
    .filter((segment) => segment.length > 0 && !PLACEHOLDER_PATTERN.test(segment))
    .map((segment) => segment.replace(/-/g, "_").toLowerCase());

  if (segments[0] === category) segments = segments.slice(1);

  if (segments.length === 0) return `zapi_${category}_${BARE_METHOD_VERB[method]}`;

  const slug = segments.join("_");
  const leadingWord = slug.split("_")[0]!;
  const prefix = PATH_VERBS.has(leadingWord) ? "" : (METHOD_VERB[method] ?? "");
  return prefix ? `zapi_${category}_${prefix}_${slug}` : `zapi_${category}_${slug}`;
}

// ---------------------------------------------------------------------------
// TypeScript emission
// ---------------------------------------------------------------------------

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function tsValue(value: unknown, indent: string): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  const inner = `${indent}  `;

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const body = value.map((element) => `${inner}${tsValue(element, inner)}`).join(",\n");
    return `[\n${body},\n${indent}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "{}";
  const body = entries
    .map(([key, v]) => `${inner}${IDENTIFIER.test(key) ? key : JSON.stringify(key)}: ${tsValue(v, inner)}`)
    .join(",\n");
  return `{\n${body},\n${indent}}`;
}

// ---------------------------------------------------------------------------
// Collection reading
// ---------------------------------------------------------------------------

function collectRequests(collection: { item?: PostmanItem[] }): FlatRequest[] {
  const flat: FlatRequest[] = [];
  const problems: string[] = [];

  const walk = (items: PostmanItem[], trail: string[]): void => {
    for (const item of items) {
      if (item.item) {
        walk(item.item, [...trail, item.name ?? ""]);
        continue;
      }
      if (!item.request) continue;

      const folder = trail[0] ?? "";
      if (EXCLUDED_FOLDERS.has(folder)) continue;

      const category = CATEGORY_BY_FOLDER[folder];
      if (!category) {
        problems.push(`unmapped folder "${folder}" for request "${item.name}"`);
        continue;
      }

      const url = item.request.url;
      const rawUrl = typeof url === "string" ? url : (url?.raw ?? "");
      if (!rawUrl.startsWith(URL_PREFIX)) {
        problems.push(`request "${item.name}" does not start with the instance URL prefix: ${rawUrl}`);
        continue;
      }

      let path = rawUrl.slice(URL_PREFIX.length).split("?")[0] ?? "";
      const rewrite = PATH_REWRITES.find((r) => r.from === path);
      if (rewrite) path = rewrite.to;

      const method = (item.request.method ?? "GET").toUpperCase();
      const body = item.request.body?.mode === "raw" ? (item.request.body.raw ?? "").trim() : "";

      flat.push({
        name: item.name ?? "",
        folder,
        category,
        method,
        path,
        description: (item.request.description ?? "").trim(),
        rawBody: body,
        bodyIsReal: body.length > 0 && method !== "GET",
        query: typeof url === "string" ? [] : (url?.query ?? []),
      });
    }
  };

  walk(collection.item ?? [], []);
  if (problems.length) throw new Error(`Collection problems:\n  ${problems.join("\n  ")}`);
  return flat;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Endpoint {
  name: string;
  category: string;
  method: string;
  path: string;
  pathParams: { name: string; placeholder: string }[];
  queryParams: string[];
  bodyParams: string[];
  summary: string;
  description: string;
  docUrl?: string;
  variants: string[];
  inputSchema: Schema;
}

const ENUM_LITERAL = /^[A-Za-z][A-Za-z0-9_-]{0,23}$/;
const MAX_EXAMPLE_BLOCK = 4000;

async function main(): Promise<void> {
  const collection = JSON.parse(await Bun.file(COLLECTION_PATH).text()) as { item?: PostmanItem[] };
  const requests = collectRequests(collection);

  // ---- group by method + path -------------------------------------------
  const groups = new Map<string, FlatRequest[]>();
  for (const request of requests) {
    const key = `${request.method} ${request.path}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(request);
    else groups.set(key, [request]);
  }

  let parsedBodies = 0;
  const ignoredBodies: string[] = [];
  const parseFailures: string[] = [];
  const doubleBound: string[] = [];
  const endpoints: Endpoint[] = [];

  for (const [key, variants] of groups) {
    const first = variants[0]!;
    const { category, method, path } = first;
    const categories = [...new Set(variants.map((v) => v.category))];
    // Two folders can name the same operation identically (Groups and
    // Communities both call it "Adicionar participantes"), so qualify.
    const variantLabels = variants.map((v) => (categories.length > 1 ? `${v.name} (${v.folder})` : v.name));

    // ---- path params ----------------------------------------------------
    const placeholders = path.match(/\{[A-Z0-9_]+\}/g) ?? [];
    const pathParams = placeholders.map((placeholder) => ({
      name: camelCase(placeholder),
      placeholder,
    }));
    const pathParamNames = new Set(pathParams.map((p) => p.name));

    // ---- query params ---------------------------------------------------
    const queryParams = new Map<string, Param>();
    for (const variant of variants) {
      for (const entry of variant.query) {
        if (!entry.key) continue;
        if (pathParamNames.has(entry.key)) doubleBound.push(`${key}: "${entry.key}" (path + query)`);
        const schema = inferQuerySchema(entry.value);
        const prose = entry.description?.trim();
        const description = [
          prose ? (/[.!?:]$/.test(prose) ? prose : `${prose}.`) : "",
          entry.value ? `Example: ${entry.value}` : "",
        ]
          .filter(Boolean)
          .join(" ");
        if (description) schema.description = description;

        const existing = queryParams.get(entry.key);
        if (existing) {
          existing.schema = mergeSchemas(existing.schema, schema);
          existing.required = existing.required && entry.disabled !== true;
        } else {
          queryParams.set(entry.key, { name: entry.key, schema, required: entry.disabled !== true });
        }
      }
    }

    // ---- body params ----------------------------------------------------
    const bodySchemas = new Map<string, Schema>();
    const activeCount = new Map<string, number>();
    const stringValues = new Map<string, string[]>();
    const exampleBodies: { variant: string; raw: string }[] = [];

    for (const [index, variant] of variants.entries()) {
      if (!variant.rawBody) continue;

      let parsed: ReturnType<typeof lenientParse>;
      try {
        parsed = lenientParse(variant.rawBody);
      } catch (error) {
        parseFailures.push(`${key} (${variant.name}): ${(error as Error).message}`);
        continue;
      }
      parsedBodies++;

      if (!variant.bodyIsReal) {
        ignoredBodies.push(`${key} (${variant.name})`);
        continue;
      }
      exampleBodies.push({ variant: variantLabels[index]!, raw: variant.rawBody });

      for (const [name, value] of Object.entries(parsed.obj)) {
        activeCount.set(name, (activeCount.get(name) ?? 0) + 1);
        const schema = inferSchema(value);
        const existing = bodySchemas.get(name);
        bodySchemas.set(name, existing ? mergeSchemas(existing, schema) : schema);
        if (typeof value === "string") {
          const seen = stringValues.get(name) ?? [];
          seen.push(value);
          stringValues.set(name, seen);
        }
      }

      for (const [name, value] of parsed.commented) {
        const schema = value === undefined ? {} : inferSchema(value);
        const existing = bodySchemas.get(name);
        bodySchemas.set(name, existing ? mergeSchemas(existing, schema) : schema);
      }
    }

    const bodyParams: Param[] = [];
    for (const [name, schema] of bodySchemas) {
      // The collection sometimes repeats a path param in the body (see
      // /redefine-invitation-link/{COMMUNITY_ID}); keep both bindings so the
      // request goes out exactly as the collection documents it.
      if (pathParamNames.has(name)) doubleBound.push(`${key}: "${name}" (path + body)`);
      // A field is required only when it is present and active in every variant.
      bodyParams.push({ name, schema, required: (activeCount.get(name) ?? 0) === variants.length });
    }

    // A key whose value differs across variants but always looks like a
    // literal token (modify-chat's `action`) is really an enum.
    if (variants.length > 1) {
      for (const param of bodyParams) {
        if (!param.required || param.schema.type !== "string") continue;
        const values = stringValues.get(param.name) ?? [];
        if (values.length !== variants.length) continue;
        const distinct = [...new Set(values)];
        if (distinct.length < 2 || !distinct.every((value) => ENUM_LITERAL.test(value))) continue;
        param.schema = { ...param.schema, enum: distinct };
      }
    }

    // ---- schema ---------------------------------------------------------
    const properties: Record<string, Schema> = {};
    const required: string[] = [];

    const require = (name: string): void => {
      if (!required.includes(name)) required.push(name);
    };

    for (const { name, placeholder } of pathParams) {
      properties[name] = {
        type: "string",
        description: PATH_PARAM_DOCS[placeholder.replace(/[{}]/g, "")] ?? `Path segment ${placeholder}.`,
      };
      require(name);
    }
    for (const param of [...queryParams.values(), ...bodyParams]) {
      // A path param already owns the property; its description is the useful one.
      if (!pathParamNames.has(param.name)) properties[param.name] = param.schema;
      if (param.required) require(param.name);
    }

    const inputSchema: Schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties,
      required,
      // Z-API accepts fields the collection never documents; let them through.
      additionalProperties: true,
    };

    // ---- description ----------------------------------------------------
    const docUrl = DOC_URLS.get(key);
    const rewrite = PATH_REWRITES.find((r) => r.to === path);

    const sections: string[] = [];
    const descriptions = [...new Set(variants.map((v) => v.description).filter(Boolean))];
    if (descriptions.length) sections.push(descriptions.join("\n\n"));
    if (categories.length > 1) sections.push(`Also applies to: ${categories.slice(1).join(", ")}.`);
    if (variants.length > 1) {
      sections.push(`This one tool covers ${variants.length} variants: ${variantLabels.join(" | ")}.`);
    }
    if (rewrite) sections.push(`Note: ${rewrite.note}`);

    const renderExample = (example: { variant: string; raw: string }): string =>
      variants.length > 1
        ? `Example request body — ${example.variant}:\n\`\`\`json\n${example.raw}\n\`\`\``
        : `Example request body:\n\`\`\`json\n${example.raw}\n\`\`\``;

    if (exampleBodies.length) {
      const all = exampleBodies.map(renderExample).join("\n\n");
      if (all.length <= MAX_EXAMPLE_BLOCK) {
        sections.push(all);
      } else {
        sections.push(renderExample(exampleBodies[0]!));
        sections.push(`(${exampleBodies.length - 1} further variant example bodies omitted for brevity.)`);
      }
    }
    if (docUrl) sections.push(`Docs: ${docUrl}`);

    endpoints.push({
      name: baseName(category, method, path),
      category,
      method,
      path,
      pathParams,
      queryParams: [...queryParams.keys()],
      bodyParams: bodyParams.map((p) => p.name),
      summary: first.name,
      description: sections.join("\n\n"),
      docUrl,
      variants: variantLabels,
      inputSchema,
    });
  }

  // ---- collision resolution ---------------------------------------------
  const byName = new Map<string, Endpoint[]>();
  for (const endpoint of endpoints) {
    const bucket = byName.get(endpoint.name);
    if (bucket) bucket.push(endpoint);
    else byName.set(endpoint.name, [endpoint]);
  }

  const disambiguated: string[] = [];
  for (const [name, colliding] of byName) {
    if (colliding.length < 2) continue;
    for (const endpoint of colliding) {
      if (endpoint.pathParams.length === 0) continue;
      const suffix = endpoint.pathParams.map((p) => snakeCase(p.placeholder)).join("_and_");
      endpoint.name = `${name}_by_${suffix}`;
      disambiguated.push(`${name} -> ${endpoint.name}  (${endpoint.method} ${endpoint.path})`);
    }
  }

  const finalNames = new Map<string, Endpoint>();
  const collisions: string[] = [];
  for (const endpoint of endpoints) {
    if (!NAME_PATTERN.test(endpoint.name)) {
      collisions.push(`invalid tool name "${endpoint.name}" (${endpoint.method} ${endpoint.path})`);
      continue;
    }
    const previous = finalNames.get(endpoint.name);
    if (previous) {
      collisions.push(
        `duplicate tool name "${endpoint.name}": ${previous.method} ${previous.path} vs ${endpoint.method} ${endpoint.path}`,
      );
      continue;
    }
    finalNames.set(endpoint.name, endpoint);
  }

  // ---- assertions --------------------------------------------------------
  const failures: string[] = [];
  if (collisions.length) failures.push(...collisions);
  if (parseFailures.length) {
    failures.push(`${parseFailures.length} body parse failure(s):\n  ${parseFailures.join("\n  ")}`);
  }
  if (endpoints.length !== EXPECTED_TOTAL) {
    failures.push(`expected ${EXPECTED_TOTAL} endpoints, generated ${endpoints.length}`);
  }
  if (parsedBodies !== EXPECTED_BODY_COUNT) {
    failures.push(`expected ${EXPECTED_BODY_COUNT} parsed request bodies, parsed ${parsedBodies}`);
  }

  const perCategory: Record<string, number> = {};
  for (const endpoint of endpoints) perCategory[endpoint.category] = (perCategory[endpoint.category] ?? 0) + 1;
  for (const [category, expected] of Object.entries(EXPECTED_PER_CATEGORY)) {
    const actual = perCategory[category] ?? 0;
    if (actual !== expected) failures.push(`category ${category}: expected ${expected}, got ${actual}`);
  }
  for (const category of Object.keys(perCategory)) {
    if (!(category in EXPECTED_PER_CATEGORY)) failures.push(`unexpected category ${category}`);
  }

  for (const endpoint of endpoints) {
    const required = new Set(endpoint.inputSchema.required as string[]);
    const properties = endpoint.inputSchema.properties as Record<string, Schema>;
    for (const { name, placeholder } of endpoint.pathParams) {
      if (!properties[name]) failures.push(`${endpoint.name}: path param ${placeholder} missing from schema`);
      if (!required.has(name)) failures.push(`${endpoint.name}: path param ${placeholder} is not required`);
      if (!endpoint.path.includes(placeholder)) {
        failures.push(`${endpoint.name}: placeholder ${placeholder} absent from path`);
      }
    }
  }

  if (failures.length) {
    console.error(`\ngenerate-endpoints failed:\n  - ${failures.join("\n  - ")}\n`);
    process.exit(1);
  }

  // ---- emit --------------------------------------------------------------
  endpoints.sort((a, b) => a.name.localeCompare(b.name));

  const header = `// Code generated by scripts/generate-endpoints.ts. DO NOT EDIT.
//
// Source: postman-collection-z-api.json (Z-API Collection, Postman v2.1).
// Regenerate with: bun run scripts/generate-endpoints.ts
//
// ${endpoints.length} endpoints. The Partners folder is excluded on purpose.
// Paths are relative to https://api.z-api.io/instances/<id>/token/<token>.

/** A single Z-API operation, ready to be registered as an MCP tool. */
export interface EndpointDef {
  /** Tool name, e.g. \`zapi_messages_send_text\`. Unique across ENDPOINTS. */
  name: string;
  /** Toolset this endpoint belongs to, e.g. \`messages\`. */
  category: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** Instance-relative path template, e.g. \`/contacts/{PHONE_NUMBER}\`. */
  path: string;
  /** Arguments substituted into \`path\`; \`placeholder\` is the literal to replace. */
  pathParams: { name: string; placeholder: string }[];
  /** Argument names that belong in the query string. */
  queryParams: string[];
  /**
   * Argument names that belong in the JSON request body. One endpoint
   * (\`POST /redefine-invitation-link/{COMMUNITY_ID}\`) repeats a path param
   * here, matching the collection, so these lists can overlap \`pathParams\`.
   */
  bodyParams: string[];
  /** Original Postman request name (Portuguese). */
  summary: string;
  /** Prose, merged variants, verbatim example bodies and the doc link. */
  description: string;
  docUrl?: string;
  /** Postman requests merged into this endpoint. */
  variants: string[];
  /** JSON Schema draft 2020-12 describing every accepted argument. */
  inputSchema: Record<string, unknown>;
}

export const ENDPOINTS: EndpointDef[] = `;

  const body = tsValue(
    endpoints.map((endpoint) => ({
      name: endpoint.name,
      category: endpoint.category,
      method: endpoint.method,
      path: endpoint.path,
      pathParams: endpoint.pathParams,
      queryParams: endpoint.queryParams,
      bodyParams: endpoint.bodyParams,
      summary: endpoint.summary,
      description: endpoint.description,
      docUrl: endpoint.docUrl,
      variants: endpoint.variants,
      inputSchema: endpoint.inputSchema,
    })),
    "",
  );

  await Bun.write(OUTPUT_PATH, `${header}${body};\n`);

  // ---- report ------------------------------------------------------------
  const merged = endpoints.filter((endpoint) => endpoint.variants.length > 1);
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(`  endpoints        ${endpoints.length}`);
  console.log(`  bodies parsed    ${parsedBodies} (0 failures, ${ignoredBodies.length} ignored)`);
  console.log(`  with docUrl      ${endpoints.filter((e) => e.docUrl).length}`);
  console.log(`  name collisions  0`);
  console.log("\nper category:");
  for (const [category, count] of Object.entries(EXPECTED_PER_CATEGORY)) {
    console.log(`  ${category.padEnd(12)} ${count}`);
  }
  console.log("\nmerged variants:");
  for (const endpoint of merged) {
    console.log(`  ${endpoint.name.padEnd(34)} x${endpoint.variants.length}  ${endpoint.method} ${endpoint.path}`);
  }
  console.log("\ndisambiguated collisions:");
  for (const line of disambiguated) console.log(`  ${line}`);
  if (ignoredBodies.length) {
    console.log("\nGET request bodies ignored (stale copy-paste in the collection):");
    for (const line of ignoredBodies) console.log(`  ${line}`);
  }
  if (doubleBound.length) {
    console.log("\nparams bound in two places:");
    for (const line of doubleBound) console.log(`  ${line}`);
  }
}

if (import.meta.main) {
  await main();
}
