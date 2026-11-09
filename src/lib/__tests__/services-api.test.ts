import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  handleServiceCall,
  handleServiceManifestPost,
  handleServicesGet,
  handleServiceTokensPost,
} from "@/lib/api/http";
import { withRestrictedCors } from "@/lib/api/origin";
import { getStorageProviderReady } from "@/lib/storage/registry";
import { mintServiceToken } from "@/lib/services/token";

const root = mkdtempSync(join(tmpdir(), "nshde-services-"));
const serviceDir = join(root, "functions", "services", "greeting");
const calls: unknown[] = [];
let gateway: Server;

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}

beforeAll(async () => {
  process.env.NSHDE_STORAGE = "memory";
  process.env.ALCHEMIST_DIR = root;
  delete process.env.NSHDE_IDE_ORIGIN;
  mkdirSync(serviceDir, { recursive: true });
  writeFileSync(join(serviceDir, "tool.ex"), "defmodule AgentFn.Services.Greeting do\nend\n");
  writeFileSync(
    join(serviceDir, "meta.json"),
    JSON.stringify({
      description: "Greet someone.\n\nMore.",
      service: {
        input_schema: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
        output_schema: { type: "object", properties: { message: { type: "string" } } },
      },
    }),
  );
  mkdirSync(join(root, "functions", "services", "draft"), { recursive: true });
  writeFileSync(join(root, "functions", "services", "draft", "tool.ex"), "x");

  // Stands in for Runtime.ServiceGateway: answers every call with its args.
  gateway = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4 || buffer.length < 4 + buffer.readUInt32BE(0)) return;
      const request = JSON.parse(buffer.subarray(4).toString());
      calls.push(request);
      const body = Buffer.from(JSON.stringify({ ok: true, result: { message: `Hello, ${request.args.name}!` } }));
      const header = Buffer.alloc(4);
      header.writeUInt32BE(body.length);
      socket.end(Buffer.concat([header, body]));
    });
  });
  await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  const address = gateway.address();
  mkdirSync(join(root, "runtime", ".alchemist"), { recursive: true });
  writeFileSync(join(root, "runtime", ".alchemist", "gateway_port"), String(typeof address === "object" && address ? address.port : 0));
});

afterAll(() => {
  gateway.close();
  rmSync(root, { recursive: true, force: true });
});

describe("services", () => {
  test("lists services from the alchemist tree", async () => {
    const data = (await handleServicesGet().json()) as { configured: boolean; services: { slug: string; valid: boolean; published: boolean; summary: string }[] };
    expect(data.configured).toBe(true);
    expect(data.services.map((s) => [s.slug, s.valid, s.published])).toEqual([
      ["draft", false, false],
      ["greeting", true, false],
    ]);
    expect(data.services[1].summary).toBe("Greet someone.");
  });

  test("publish writes the manifest and the generated types", async () => {
    expect((await handleServiceManifestPost(post("http://ide/api/service-manifest", { slug: "draft" }))).status).toBe(422);
    const res = await handleServiceManifestPost(post("http://ide/api/service-manifest", { slug: "greeting" }));
    expect(res.status).toBe(200);
    const manifest = JSON.parse(readFileSync(join(root, "runtime", ".alchemist", "services.json"), "utf8"));
    expect(manifest.services).toHaveLength(1);
    expect(manifest.services[0].slug).toBe("greeting");
    expect(manifest.services[0].source_sha256).toMatch(/^[0-9a-f]{64}$/);
    const types = await (await getStorageProviderReady()).read("components/services.d.ts");
    expect(String(types)).toContain('"greeting": {');
  });

  test("a source change marks the service stale", async () => {
    writeFileSync(join(serviceDir, "tool.ex"), "defmodule AgentFn.Services.Greeting do\n# changed\nend\n");
    const data = (await handleServicesGet().json()) as { services: { slug: string; stale: boolean }[] };
    expect(data.services.find((s) => s.slug === "greeting")?.stale).toBe(true);
    await handleServiceManifestPost(post("http://ide/api/service-manifest", { slug: "greeting" }));
  });

  test("mints a token from a component's capabilities", async () => {
    const storage = await getStorageProviderReady();
    await storage.write("components/hello.nsh.tsx", 'export const capabilities = ["service:greeting"];\nexport default () => null;\n');
    const data = (await (await handleServiceTokensPost(post("http://ide/api/service-tokens", { path: "components/hello.nsh.tsx" }))).json()) as {
      token: string;
      slugs: string[];
    };
    expect(data.slugs).toEqual(["greeting"]);
    expect(data.token).toContain(".");
    const none = (await (await handleServiceTokensPost(post("http://ide/api/service-tokens", { path: "components/welcome.nsh.tsx" }))).json()) as {
      token: null;
    };
    expect(none.token).toBeNull();
  });

  test("calls need a token scoped to the slug", async () => {
    const url = "http://ide/api/services/greeting";
    expect((await handleServiceCall(post(url, { name: "Ada" }), "greeting")).status).toBe(401);
    const other = mintServiceToken(["weather"]).token;
    expect((await handleServiceCall(post(url, { name: "Ada" }, { Authorization: `Bearer ${other}` }), "greeting")).status).toBe(403);

    const { token } = mintServiceToken(["greeting"]);
    const res = await handleServiceCall(post(url, { name: "Ada" }, { Authorization: `Bearer ${token}` }), "greeting");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: { message: "Hello, Ada!" } });
    expect(calls.at(-1)).toEqual({ op: "call", name: "greeting", args: { name: "Ada" } });
  });

  test("origins: the preview's opaque origin may call, other sites may not, and only the IDE mints", async () => {
    const policy = { allowOpaque: true, methods: "POST, OPTIONS" };
    const ok = () => Response.json({ ok: true });
    const from = (origin: string) => new Request("http://127.0.0.1:43123/api/services/greeting", { method: "POST", headers: { Origin: origin } });

    const preview = await withRestrictedCors(from("null"), policy, ok);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("access-control-allow-origin")).toBe("null");
    expect((await withRestrictedCors(from("https://evil.example"), policy, ok)).status).toBe(403);
    expect((await withRestrictedCors(from("http://127.0.0.1:8790"), policy, ok)).status).toBe(200);
    expect((await withRestrictedCors(from("null"), { methods: "POST" }, ok)).status).toBe(403);

    process.env.NSHDE_IDE_ORIGIN = "https://ide.example";
    try {
      expect((await withRestrictedCors(from("http://127.0.0.1:8790"), policy, ok)).status).toBe(403);
      const ide = await withRestrictedCors(from("https://ide.example"), policy, ok);
      expect(ide.headers.get("access-control-allow-origin")).toBe("https://ide.example");
    } finally {
      delete process.env.NSHDE_IDE_ORIGIN;
    }
  });
});
