/**
 * Origin policy for the service routes (`/api/services/:slug`,
 * `/api/service-tokens`, `/api/service-manifest`). Other routes keep `*`.
 *
 * Allowed origins are `NSHDE_IDE_ORIGIN` (comma-separated) when set. Otherwise
 * they are this server's own origin and, outside production, any
 * `localhost` / `127.0.0.1` port (the `nsh run` dev server).
 *
 * The preview runs in a WebView without `allow-same-origin`, so its requests
 * carry `Origin: null`. Service calls (`allowOpaque`) accept that; the token
 * is what scopes them. Minting tokens and publishing do not.
 */

export interface OriginPolicy {
  allowOpaque?: boolean;
  methods: string;
}

function configured(env: Record<string, string | undefined>): string[] | null {
  const raw = env.NSHDE_IDE_ORIGIN?.trim();
  if (!raw) return null;
  return raw
    .split(",")
    .map((item) => item.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

export function originAllowed(
  origin: string,
  req: Request,
  policy: OriginPolicy,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (origin === "null") return !!policy.allowOpaque;
  const list = configured(env);
  if (list) return list.includes(origin);
  if (origin === new URL(req.url).origin) return true;
  if (env.NODE_ENV === "production") return false;
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === "http:" && (hostname === "localhost" || hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

function corsHeaders(origin: string | null, policy: OriginPolicy): Headers {
  const headers = new Headers({ Vary: "Origin" });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", policy.methods);
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    headers.set("Access-Control-Max-Age", "600");
  }
  return headers;
}

function refuse(): Response {
  return Response.json({ ok: false, code: "origin_refused", error: "origin not allowed" }, { status: 403, headers: { Vary: "Origin" } });
}

/** Preflight for a restricted route. */
export function restrictedPreflight(req: Request, policy: OriginPolicy): Response {
  const origin = req.headers.get("origin");
  if (origin && !originAllowed(origin, req, policy)) return refuse();
  return new Response(null, { status: 204, headers: corsHeaders(origin, policy) });
}

/**
 * Runs `handler` only for an allowed origin (or a request without `Origin`,
 * such as one from a server or `curl`). A refused origin gets 403 before the
 * handler runs, so a "simple" cross-origin POST cannot act either.
 */
export async function withRestrictedCors(
  req: Request,
  policy: OriginPolicy,
  handler: (req: Request) => Response | Promise<Response>,
): Promise<Response> {
  const origin = req.headers.get("origin");
  if (origin && !originAllowed(origin, req, policy)) return refuse();
  let response: Response;
  try {
    response = await handler(req);
  } catch (error) {
    response = Response.json(
      { ok: false, error: error instanceof Error ? error.message : "request failed" },
      { status: 500 },
    );
  }
  for (const [key, value] of corsHeaders(origin, policy)) response.headers.set(key, value);
  return response;
}
