import { host } from "nsh";
import { parseAgentEvents, type AgentDefinition, type AgentEvent, type AgentId } from "../lib/agents";
import type { ServiceInfo } from "../lib/services/registry";
import type { StorageBackend } from "../lib/storage/types";

export interface TreeNode {
  path: string;
  name: string;
  kind: "file" | "directory";
  children?: TreeNode[];
}

function defaultBase(): string {
  if (typeof location === "undefined") return "http://127.0.0.1:43123";
  const { protocol, hostname, port, origin } = location;
  if (port === "43123" || port === "") return origin;
  if ((hostname === "127.0.0.1" || hostname === "localhost") && port !== "43123") {
    return `${protocol}//${hostname}:43123`;
  }
  return origin;
}

async function apiBase(): Promise<string> {
  if (host.available()) {
    try {
      const info = (await host.call("nshde.apiBase", {})) as { base: string };
      if (info.base) return info.base;
    } catch {
      /* fall through to fetch */
    }
  }
  return defaultBase();
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await apiBase();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<T>;
}

async function hostOrFetch<T>(name: string, args: Record<string, unknown>, fetchFn: () => Promise<T>): Promise<T> {
  if (host.available()) {
    try {
      return (await host.call(name, args)) as T;
    } catch {
      /* host bridge failed — use direct fetch */
    }
  }
  return fetchFn();
}

export async function loadConfig(): Promise<{ backend: StorageBackend }> {
  return hostOrFetch("nshde.config", {}, () => fetchJson("/api/config"));
}

export async function loadTree(): Promise<{ tree: TreeNode[]; backend: StorageBackend }> {
  return hostOrFetch("nshde.storage.tree", {}, () => fetchJson("/api/storage?tree=1"));
}

export async function readFile(path: string): Promise<string> {
  if (path.endsWith(".wasm")) {
    return "// Binary WASM — edit via agent or external toolchain";
  }
  const data = await hostOrFetch("nshde.storage.read", { path }, () =>
    fetchJson<{ content?: string }>(`/api/storage?path=${encodeURIComponent(path)}`),
  );
  return (data as { content?: string }).content ?? "";
}

export async function writeFile(path: string, content: string): Promise<void> {
  await hostOrFetch(
    "nshde.storage.write",
    { path, content },
    () =>
      fetchJson("/api/storage", {
        method: "POST",
        body: JSON.stringify({ path, content }),
      }),
  );
}

export async function setBackend(backend: StorageBackend): Promise<void> {
  await hostOrFetch(
    "nshde.storage.backend",
    { backend },
    () =>
      fetchJson("/api/storage", {
        method: "POST",
        body: JSON.stringify({ backend }),
      }),
  );
}

export async function listAgents(): Promise<AgentDefinition[]> {
  const data = await hostOrFetch("nshde.agents.list", {}, () =>
    fetchJson<{ agents: AgentDefinition[] }>("/api/agents"),
  );
  return (data as { agents: AgentDefinition[] }).agents;
}

/**
 * Runs one agent turn and calls `onEvent` for each streamed event.
 * Falls back to reading the whole response where the runtime's fetch has no body stream.
 */
export async function streamAgent(
  turn: { prompt: string; agentId: AgentId; sessionId?: string },
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  const base = await apiBase();
  const res = await fetch(`${base}/api/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(turn),
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      /* plain text error */
    }
    throw new Error(message || `Agent request failed (${res.status})`);
  }

  const reader = res.body?.getReader?.();
  if (!reader) {
    for (const event of parseAgentEvents(`${await res.text()}\n\n`).events) onEvent(event);
    return;
  }
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    const parsed = parseAgentEvents(done ? `${buffer}\n\n` : buffer);
    buffer = parsed.rest;
    for (const event of parsed.events) onEvent(event);
    if (done) return;
  }
}

export async function listServices(): Promise<{ configured: boolean; services: ServiceInfo[] }> {
  return fetchJson("/api/services");
}

export async function publishService(slug: string, published: boolean): Promise<void> {
  await fetchJson("/api/service-manifest", {
    method: "POST",
    body: JSON.stringify({ slug, published }),
  });
}

/** A token for the services a stored component declares, or null when it declares none. */
async function serviceToken(path: string): Promise<string | null> {
  try {
    const data = await fetchJson<{ token: string | null }>("/api/service-tokens", {
      method: "POST",
      body: JSON.stringify({ path }),
    });
    return data.token;
  } catch {
    return null;
  }
}

export async function previewUrl(path: string | null, revision: number): Promise<string> {
  const base = await apiBase();
  if (!path) return `${base}/preview/blank`;
  const url = `${base}/preview?path=${encodeURIComponent(path)}&r=${revision}`;
  const token = path.endsWith(".nsh.tsx") ? await serviceToken(path) : null;
  // In the fragment, so the token is neither sent with the page request nor logged.
  return token ? `${url}#token=${encodeURIComponent(token)}` : url;
}
