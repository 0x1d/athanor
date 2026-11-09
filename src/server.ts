import {
  handleAgentsGet,
  handleAgentsPost,
  handleConfigGet,
  handleModulesCheck,
  handleServiceCall,
  handleServiceManifestPost,
  handleServicesGet,
  handleServiceTokensPost,
  handleServiceTypesGet,
  handleStorageDelete,
  handleStorageGet,
  handleStoragePost,
} from "@/lib/api/http";
import { restrictedPreflight, withRestrictedCors, type OriginPolicy } from "@/lib/api/origin";
import { buildPreviewBundle } from "@/lib/preview-bundle";
import { resolveWebRoot, serveWebFile } from "@/lib/web-static";

const port = Number(process.env.PORT) || 43123;
const preview = await buildPreviewBundle();
const webRoot = resolveWebRoot();
if (webRoot) {
  console.log(`nshde web UI: ${webRoot}`);
} else {
  console.log("nshde web UI not packaged — run: nsh package . --target web");
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function withCors(response: Response): Response {
  for (const [key, value] of Object.entries(corsHeaders())) {
    response.headers.set(key, value);
  }
  return response;
}

async function withCorsAsync(fn: (req: Request) => Response | Promise<Response>, req: Request) {
  try {
    return withCors(await fn(req));
  } catch (e) {
    return withCors(
      Response.json(
        { error: e instanceof Error ? e.message : "request failed" },
        { status: 500, headers: { "Content-Type": "application/json" } },
      ),
    );
  }
}

function asset(body: string, contentType: string): Response {
  const headers = new Headers(corsHeaders());
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "no-cache");
  return new Response(body, { headers });
}

/** Service calls come from the preview, whose WebView origin is opaque (`null`). */
const serviceCallPolicy: OriginPolicy = { allowOpaque: true, methods: "POST, OPTIONS" };
/** Minting tokens and publishing are IDE actions only. */
const idePolicy: OriginPolicy = { methods: "POST, OPTIONS" };

const server = Bun.serve({
  port,
  routes: {
    "/preview": () => asset(preview.html, "text/html; charset=utf-8"),
    "/preview/blank": () => asset(preview.html, "text/html; charset=utf-8"),
    "/preview/runtime.js": () => asset(preview.js, "text/javascript; charset=utf-8"),
    "/preview/runtime.css": () => asset(preview.css, "text/css; charset=utf-8"),
    "/favicon.ico": Bun.file("public/favicon.ico"),
    "/api/agents": {
      GET: () => withCors(handleAgentsGet()),
      POST: (req, srv) => {
        // An agent turn streams for as long as the agent works.
        srv.timeout(req, 0);
        return withCorsAsync(handleAgentsPost, req);
      },
      OPTIONS: () => new Response(null, { headers: corsHeaders() }),
    },
    "/api/config": {
      GET: () => withCors(handleConfigGet()),
      OPTIONS: () => new Response(null, { headers: corsHeaders() }),
    },
    "/api/modules/check": {
      POST: (req) => withCorsAsync(handleModulesCheck, req),
      OPTIONS: () => new Response(null, { headers: corsHeaders() }),
    },
    "/api/services": {
      GET: () => withCors(handleServicesGet()),
      OPTIONS: () => new Response(null, { headers: corsHeaders() }),
    },
    "/api/services/:slug": {
      POST: (req) => withRestrictedCors(req, serviceCallPolicy, (r) => handleServiceCall(r, req.params.slug)),
      OPTIONS: (req) => restrictedPreflight(req, serviceCallPolicy),
    },
    "/api/service-manifest": {
      POST: (req) => withRestrictedCors(req, idePolicy, handleServiceManifestPost),
      OPTIONS: (req) => restrictedPreflight(req, idePolicy),
    },
    "/api/service-tokens": {
      POST: (req) => withRestrictedCors(req, idePolicy, handleServiceTokensPost),
      OPTIONS: (req) => restrictedPreflight(req, idePolicy),
    },
    "/api/service-types": {
      GET: () => withCors(handleServiceTypesGet()),
      OPTIONS: () => new Response(null, { headers: corsHeaders() }),
    },
    "/api/storage": {
      GET: (req) => withCorsAsync(handleStorageGet, req),
      POST: (req) => withCorsAsync(handleStoragePost, req),
      DELETE: (req) => withCorsAsync(handleStorageDelete, req),
      OPTIONS: () => new Response(null, { headers: corsHeaders() }),
    },
  },
  fetch(req) {
    const url = new URL(req.url);
    if (req.method !== "GET" && req.method !== "HEAD") {
      return withCors(new Response("Method Not Allowed", { status: 405 }));
    }
    if (webRoot) {
      const staticResponse = serveWebFile(webRoot, url.pathname);
      if (staticResponse) return withCors(staticResponse);
    }
    if (url.pathname === "/") {
      return withCors(
        new Response(
          "nshde API — run the IDE with: nsh run App.tsx --target web (API on this port)\n",
          { headers: { "Content-Type": "text/plain; charset=utf-8" } },
        ),
      );
    }
    return withCors(new Response("Not Found", { status: 404 }));
  },
  development: process.env.NODE_ENV !== "production",
});

console.log(`nshde API listening on ${server.url}`);
