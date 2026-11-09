import { expect, test } from "bun:test";
import { bearerToken, mintServiceToken, verifyServiceToken } from "@/lib/services/token";

test("a token is scoped to its slugs and expires", () => {
  const now = 1_000_000;
  const { token, slugs, expiresAt } = mintServiceToken(["b", "a", "a"], 60_000, now);
  expect(slugs).toEqual(["a", "b"]);
  expect(expiresAt).toBe(now + 60_000);
  expect(verifyServiceToken(token, "a", now)).toEqual({ ok: true, slugs: ["a", "b"] });
  expect(verifyServiceToken(token, "c", now)).toEqual({ ok: false, reason: "out_of_scope" });
  expect(verifyServiceToken(token, "a", now + 60_000)).toEqual({ ok: false, reason: "expired" });
  expect(verifyServiceToken(null, "a", now)).toEqual({ ok: false, reason: "missing" });
  expect(verifyServiceToken("abc", "a", now)).toEqual({ ok: false, reason: "malformed" });
});

test("a changed payload fails the signature", () => {
  const { token } = mintServiceToken(["a"]);
  const [, signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ s: ["a", "admin"], e: Date.now() + 1e9 })).toString("base64url");
  expect(verifyServiceToken(`${forged}.${signature}`, "admin")).toEqual({ ok: false, reason: "bad_signature" });
});

test("reads a bearer token", () => {
  expect(bearerToken(new Request("http://x", { headers: { Authorization: "Bearer abc.def" } }))).toBe("abc.def");
  expect(bearerToken(new Request("http://x"))).toBeNull();
});
