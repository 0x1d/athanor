import { AGENTS, type AgentId } from "@/lib/agents";
import { agentSidecarUrl, openSidecarStream } from "@/lib/agents/sidecar";
import { checkModule, isServiceSlug, serviceScopes } from "@/lib/modules/check";
import { callGateway, gatewayStatus } from "@/lib/services/gateway";
import { gatewayPort, listServices, serviceConfig, ServiceError, setPublished } from "@/lib/services/registry";
import { bearerToken, mintServiceToken, verifyServiceToken } from "@/lib/services/token";
import { SERVICE_TYPES_PATH, serviceDeclarations } from "@/lib/services/types";
import {
  getStorageBackend,
  getStorageProvider,
  getStorageProviderReady,
  getStorageTree,
  setStorageBackend,
} from "@/lib/storage/registry";
import type { StorageBackend } from "@/lib/storage/types";

function json(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  return Response.json(data, { ...init, headers });
}

export function handleAgentsGet() {
  return json({ agents: AGENTS });
}

/**
 * Proxies one agent turn to the sidecar and streams its SSE back.
 * Body: `{ prompt, agentId?, sessionId? }`.
 */
export async function handleAgentsPost(req: Request) {
  const base = agentSidecarUrl();
  if (!base) {
    return json({ error: "Agent sidecar not configured. Set NSHDE_AGENT_URL to the alchemist nshde host." }, { status: 503 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    prompt?: string;
    agentId?: AgentId;
    sessionId?: string;
  };
  if (!body.prompt?.trim()) {
    return json({ error: "prompt required" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await openSidecarStream(
      base,
      {
        prompt: body.prompt,
        agentId: body.agentId,
        sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
      },
      req.signal,
    );
  } catch (e) {
    return json({ error: `Agent sidecar unreachable at ${base}: ${e instanceof Error ? e.message : e}` }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return json({ error: `Agent sidecar ${upstream.status}: ${detail}` }, { status: 502 });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Compiles a component with Sucrase. Body: `{ source }` or `{ path }` (read from storage). */
export async function handleModulesCheck(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { source?: unknown; path?: unknown };
  let source: string;
  if (typeof body.source === "string") {
    source = body.source;
  } else if (typeof body.path === "string") {
    const content = await (await getStorageProviderReady()).read(body.path).catch(() => null);
    if (typeof content !== "string") return json({ error: `cannot read ${body.path}` }, { status: 404 });
    source = content;
  } else {
    return json({ error: "source or path required" }, { status: 400 });
  }
  return json(checkModule(source));
}

function servicesUnconfigured() {
  return json(
    { error: "Services are not configured. Set ALCHEMIST_DIR (or AGENT_FUNCTIONS_DIR) to the alchemist checkout." },
    { status: 503 },
  );
}

/** Lists alchemist services (read-only). */
export function handleServicesGet() {
  const config = serviceConfig();
  if (!config) return json({ configured: false, services: [] });
  return json({ configured: true, services: listServices(config) });
}

async function writeServiceTypes() {
  const config = serviceConfig();
  if (!config) return;
  await (await getStorageProviderReady()).write(SERVICE_TYPES_PATH, serviceDeclarations(listServices(config)));
}

/** Publishes or unpublishes a service. Body: `{ slug, published }`. */
export async function handleServiceManifestPost(req: Request) {
  const config = serviceConfig();
  if (!config) return servicesUnconfigured();
  const body = (await req.json().catch(() => ({}))) as { slug?: unknown; published?: unknown };
  if (typeof body.slug !== "string" || !isServiceSlug(body.slug)) {
    return json({ error: "slug required" }, { status: 400 });
  }
  try {
    const service = await setPublished(config, body.slug, body.published !== false);
    await writeServiceTypes();
    return json({ ok: true, service });
  } catch (e) {
    if (e instanceof ServiceError) return json({ error: e.message }, { status: e.status });
    throw e;
  }
}

/** `@nshde/services` declarations generated from the schemas. */
export function handleServiceTypesGet() {
  const config = serviceConfig();
  const body = serviceDeclarations(config ? listServices(config) : []);
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/**
 * Mints a short-lived token for a stored component, scoped to the services
 * in its `export const capabilities`. Body: `{ path }`.
 */
export async function handleServiceTokensPost(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { path?: unknown };
  if (typeof body.path !== "string") return json({ error: "path required" }, { status: 400 });
  const source = await (await getStorageProviderReady()).read(body.path).catch(() => null);
  if (typeof source !== "string") return json({ error: `cannot read ${body.path}` }, { status: 404 });
  const slugs = serviceScopes(source);
  if (slugs.length === 0) return json({ token: null, slugs: [] });
  return json(mintServiceToken(slugs));
}

/**
 * Calls a published service through the BEAM gateway. Body: the service args.
 * Needs `Authorization: Bearer <token>` with `slug` in the token's scope.
 */
export async function handleServiceCall(req: Request, slug: string) {
  const fail = (status: number, code: string, error: string) => Response.json({ ok: false, code, error }, { status });
  if (!isServiceSlug(slug)) return fail(400, "bad_slug", "invalid service slug");

  const check = verifyServiceToken(bearerToken(req), slug);
  if (!check.ok) return fail(check.reason === "out_of_scope" ? 403 : 401, `token_${check.reason}`, `service token ${check.reason.replaceAll("_", " ")}`);

  const config = serviceConfig();
  if (!config) return fail(503, "unconfigured", "services are not configured");
  const port = gatewayPort(config);
  if (!port) return fail(503, "gateway_down", "service gateway is not running");

  const text = await req.text();
  let args: unknown = {};
  if (text.trim()) {
    try {
      args = JSON.parse(text);
    } catch {
      return fail(400, "bad_request", "body must be JSON");
    }
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) return fail(400, "invalid_input", "args must be an object");

  try {
    const response = await callGateway(port, slug, args as Record<string, unknown>);
    return Response.json(response, { status: response.ok ? 200 : gatewayStatus(response.code) });
  } catch (e) {
    return fail(503, "gateway_down", `service gateway unreachable: ${e instanceof Error ? e.message : e}`);
  }
}

export function handleConfigGet() {
  return json({
    backend: getStorageBackend(),
    options: [
      { id: "fs", label: "Local filesystem", description: ".nshde-data on server" },
      { id: "memory", label: "In-memory", description: "Ephemeral, seeded demo files" },
      { id: "s3", label: "Amazon S3", description: "Uses AWS creds when configured" },
    ],
  });
}

export async function handleStorageGet(req: Request) {
  const provider = await getStorageProviderReady();
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  const tree = url.searchParams.get("tree");

  if (tree === "1") {
    const data = await getStorageTree();
    return json({
      backend: getStorageBackend(),
      tree: data,
    });
  }

  if (!path) {
    return json({ error: "path required" }, { status: 400 });
  }

  try {
    const content = await provider.read(path);
    if (content instanceof Uint8Array) {
      return new Response(content, {
        headers: {
          "Content-Type": "application/wasm",
          "X-Nshde-Path": path,
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }
    return json({ path, content, backend: getStorageBackend() });
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "read failed" },
      { status: 404 },
    );
  }
}

export async function handleStoragePost(req: Request) {
  const body = (await req.json()) as {
    path?: string;
    content?: string;
    backend?: StorageBackend;
  };

  if (body.backend) {
    await setStorageBackend(body.backend);
    return json({ ok: true, backend: body.backend });
  }

  if (!body.path || body.content === undefined) {
    return json({ error: "path and content required" }, { status: 400 });
  }

  const provider = await getStorageProviderReady();
  await provider.write(body.path, body.content);
  return json({ ok: true, path: body.path });
}

export async function handleStorageDelete(req: Request) {
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (!path) {
    return json({ error: "path required" }, { status: 400 });
  }
  await getStorageProvider().delete(path);
  return json({ ok: true });
}
