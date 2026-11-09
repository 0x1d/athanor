import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Short-lived service tokens. The IDE mints one for the component it mounts,
 * scoped to the services that component declares, and `/api/services/:slug`
 * checks it. A token is `<payload>.<signature>`, both base64url; the payload is
 * `{ "s": [slugs], "e": <expiry ms> }` and the signature is HMAC-SHA256.
 *
 * The key is `NSHDE_SERVICE_SECRET`, or random per process (tokens then end
 * with a server restart).
 */

export const SERVICE_TOKEN_TTL_MS = 10 * 60 * 1000;

let processSecret: Buffer | null = null;

function secret(): Buffer {
  const configured = process.env.NSHDE_SERVICE_SECRET;
  if (configured) return Buffer.from(configured, "utf8");
  processSecret ??= randomBytes(32);
  return processSecret;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export interface MintedToken {
  token: string;
  slugs: string[];
  expiresAt: number;
}

export function mintServiceToken(slugs: string[], ttlMs = SERVICE_TOKEN_TTL_MS, now = Date.now()): MintedToken {
  const scope = [...new Set(slugs)].sort();
  const expiresAt = now + ttlMs;
  const payload = Buffer.from(JSON.stringify({ s: scope, e: expiresAt })).toString("base64url");
  return { token: `${payload}.${sign(payload)}`, slugs: scope, expiresAt };
}

export type TokenCheck =
  | { ok: true; slugs: string[] }
  | { ok: false; reason: "missing" | "malformed" | "bad_signature" | "expired" | "out_of_scope" };

export function verifyServiceToken(token: string | null | undefined, slug: string, now = Date.now()): TokenCheck {
  if (!token) return { ok: false, reason: "missing" };
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return { ok: false, reason: "malformed" };

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "bad_signature" };
  }

  let claims: { s?: unknown; e?: unknown };
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!Array.isArray(claims.s) || typeof claims.e !== "number") return { ok: false, reason: "malformed" };
  if (claims.e <= now) return { ok: false, reason: "expired" };
  const slugs = claims.s.filter((item): item is string => typeof item === "string");
  if (!slugs.includes(slug)) return { ok: false, reason: "out_of_scope" };
  return { ok: true, slugs };
}

/** Reads `Authorization: Bearer <token>`. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  return match ? match[1] : null;
}
