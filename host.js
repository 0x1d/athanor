/** Bridges NSH host calls to the Bun API (split ports in dev, same origin when deployed). */
function apiBase() {
  if (typeof location === "undefined") return "http://127.0.0.1:43123";
  const { protocol, hostname, port, origin } = location;
  if (port === "43123" || port === "") return origin;
  if ((hostname === "127.0.0.1" || hostname === "localhost") && port !== "43123") {
    return `${protocol}//${hostname}:43123`;
  }
  return origin;
}

async function fetchJson(path, init) {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

export async function createHost() {
  return {
    async call(name, args) {
      switch (name) {
        case "nshde.apiBase":
          return { base: apiBase() };
        case "nshde.config":
          return fetchJson("/api/config");
        case "nshde.storage.tree":
          return fetchJson("/api/storage?tree=1");
        case "nshde.storage.read": {
          const path = args?.path;
          if (!path) throw new Error("path required");
          if (String(path).endsWith(".wasm")) {
            const res = await fetch(`${apiBase()}/api/storage?path=${encodeURIComponent(path)}`);
            if (!res.ok) throw new Error("read failed");
            const buf = await res.arrayBuffer();
            return { path, wasm: Array.from(new Uint8Array(buf)) };
          }
          return fetchJson(`/api/storage?path=${encodeURIComponent(path)}`);
        }
        case "nshde.storage.write":
          return fetchJson("/api/storage", {
            method: "POST",
            body: JSON.stringify({ path: args.path, content: args.content }),
          });
        case "nshde.storage.backend":
          return fetchJson("/api/storage", {
            method: "POST",
            body: JSON.stringify({ backend: args.backend }),
          });
        case "nshde.agents.list":
          return fetchJson("/api/agents");
        default:
          throw new Error(`unknown host function ${name}`);
      }
    },
  };
}
