import iconPng from "../public/icon.png";

export const PUBLIC_ORIGIN = "https://whatsmcp.unfld.dev";
export const ICON_PNG_URL = `${PUBLIC_ORIGIN}/icon.png`;
export const ICON_SVG_URL = `${PUBLIC_ORIGIN}/icon.svg`;

export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="whatsmcp">
  <rect width="512" height="512" rx="114" fill="#25D366"/>
  <path
    fill="#fff"
    d="M166 86h176c42 0 76 34 76 76v148c0 42-34 76-76 76H206l-86 62 24-62h-4c-42 0-76-34-76-76V162c0-42 34-76 76-76z"
  />
  <path
    fill="#25D366"
    d="M256 138c4 38 18 52 56 56-38 4-52 18-56 56-4-38-18-52-56-56 38-4 52-18 56-56z"
  />
  <path
    fill="#25D366"
    d="M256 176c2 16 8 22 24 24-16 2-22 8-24 24-2-16-8-22-24-24 16-2 22-8 24-24z"
    opacity=".9"
  />
  <circle cx="404" cy="404" r="62" fill="#0B5C3A"/>
  <text
    x="404"
    y="416"
    text-anchor="middle"
    font-family="ui-sans-serif, system-ui, -apple-system, sans-serif"
    font-size="36"
    font-weight="800"
    fill="#fff"
  >AI</text>
</svg>
`;

const ICON_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=86400",
  "Access-Control-Allow-Origin": "*",
} as const;

export const SERVER_ICONS: Array<{
  src: string;
  mimeType: string;
  sizes: string[];
}> = [
  {
    src: ICON_PNG_URL,
    mimeType: "image/png",
    sizes: ["512x512"],
  },
  {
    src: ICON_SVG_URL,
    mimeType: "image/svg+xml",
    sizes: ["any"],
  },
];

async function pngBytes(): Promise<Uint8Array> {
  if (typeof iconPng !== "string") {
    return new Uint8Array(iconPng);
  }
  const bun = (
    globalThis as {
      Bun?: { file(path: string): { arrayBuffer(): Promise<ArrayBuffer> } };
    }
  ).Bun;
  if (!bun) {
    throw new Error("PNG path imports require Bun or a Wrangler Data module");
  }
  return new Uint8Array(await bun.file(iconPng).arrayBuffer());
}

export async function servePublicIcon(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (pathname !== "/icon.png" && pathname !== "/icon.svg") return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  if (pathname === "/icon.svg") {
    return new Response(request.method === "HEAD" ? null : ICON_SVG, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        ...ICON_CACHE_HEADERS,
      },
    });
  }

  const body = request.method === "HEAD" ? null : await pngBytes();
  return new Response(body, {
    headers: {
      "Content-Type": "image/png",
      ...ICON_CACHE_HEADERS,
    },
  });
}
