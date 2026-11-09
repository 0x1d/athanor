import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { isServiceSlug } from "@/lib/modules/check";

/**
 * Services are alchemist codex entries under `functions/services/<name>/`.
 * nshde reads them from the alchemist tree (read-only) and owns the manifest
 * of published `{ slug, source_sha256 }` that the BEAM service gateway enforces.
 *
 * Configuration, with the same names the alchemist runtime reads:
 * - `ALCHEMIST_DIR`: the alchemist checkout (gives the defaults below)
 * - `AGENT_FUNCTIONS_DIR`: `<ALCHEMIST_DIR>/functions`
 * - `ALCHEMIST_STATE_DIR`: `<ALCHEMIST_DIR>/runtime/.alchemist`
 * - `ALCHEMIST_SERVICE_MANIFEST`: `<state dir>/services.json`
 * - `ALCHEMIST_GATEWAY_PORT`: else read from `<state dir>/gateway_port`
 */

export interface ServiceConfig {
  functionsDir: string;
  stateDir: string;
  manifestPath: string;
  gatewayPort?: number;
}

export type JsonSchema = Record<string, unknown> | boolean;

export interface ServiceInfo {
  slug: string;
  summary: string;
  sourceSha256: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  /** Both schemas are present, so the gateway can run it. */
  valid: boolean;
  /** Listed in the manifest. */
  published: boolean;
  /** Published, but the source changed since; the gateway refuses it until it is published again. */
  stale: boolean;
}

export interface ManifestEntry {
  slug: string;
  source_sha256: string;
}

export function serviceConfig(env: Record<string, string | undefined> = process.env): ServiceConfig | null {
  const root = env.ALCHEMIST_DIR;
  const functionsDir = env.AGENT_FUNCTIONS_DIR || (root ? join(root, "functions") : undefined);
  if (!functionsDir) return null;
  const stateDir = env.ALCHEMIST_STATE_DIR || (root ? join(root, "runtime", ".alchemist") : join(functionsDir, "..", "runtime", ".alchemist"));
  const port = Number(env.ALCHEMIST_GATEWAY_PORT);
  return {
    functionsDir,
    stateDir,
    manifestPath: env.ALCHEMIST_SERVICE_MANIFEST || join(stateDir, "services.json"),
    ...(Number.isInteger(port) && port > 0 ? { gatewayPort: port } : {}),
  };
}

/** The gateway port from config, else from the `gateway_port` file the gateway writes. */
export function gatewayPort(config: ServiceConfig): number | null {
  if (config.gatewayPort) return config.gatewayPort;
  try {
    const port = Number(readFileSync(join(config.stateDir, "gateway_port"), "utf8").trim());
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function servicesRoot(config: ServiceConfig): string {
  return join(config.functionsDir, "services");
}

export function serviceDir(config: ServiceConfig, slug: string): string {
  return join(servicesRoot(config), ...slug.split("."));
}

function entryDirs(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  if (entries.some((entry) => entry.isFile() && entry.name === "tool.ex")) out.push(dir);
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== "test") entryDirs(join(dir, entry.name), out);
  }
  return out;
}

export function readManifest(config: ServiceConfig): ManifestEntry[] {
  try {
    const data = JSON.parse(readFileSync(config.manifestPath, "utf8")) as { services?: unknown };
    if (!Array.isArray(data.services)) return [];
    return data.services.filter(
      (item): item is ManifestEntry =>
        !!item &&
        typeof (item as ManifestEntry).slug === "string" &&
        typeof (item as ManifestEntry).source_sha256 === "string",
    );
  } catch {
    return [];
  }
}

async function writeManifest(config: ServiceConfig, entries: ManifestEntry[]): Promise<void> {
  const sorted = [...entries].sort((a, b) => a.slug.localeCompare(b.slug));
  await mkdir(dirname(config.manifestPath), { recursive: true });
  const temp = `${config.manifestPath}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify({ services: sorted }, null, 2)}\n`);
  await rename(temp, config.manifestPath);
}

function readService(config: ServiceConfig, dir: string, manifest: Map<string, string>): ServiceInfo | null {
  const slug = relative(servicesRoot(config), dir).split(sep).join(".");
  if (!isServiceSlug(slug)) return null;
  let source: Buffer;
  try {
    source = readFileSync(join(dir, "tool.ex"));
  } catch {
    return null;
  }
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
  } catch {
    /* no meta yet: listed as invalid */
  }
  const service = (meta.service ?? {}) as { input_schema?: JsonSchema; output_schema?: JsonSchema };
  const schemaOk = (schema: unknown) => typeof schema === "boolean" || (!!schema && typeof schema === "object");
  const text = String(meta.description ?? meta.moduledoc ?? "");
  const sourceSha256 = sha256(source);
  const published = manifest.get(slug);
  return {
    slug,
    summary: text.split("\n")[0]?.trim() ?? "",
    sourceSha256,
    ...(schemaOk(service.input_schema) ? { inputSchema: service.input_schema } : {}),
    ...(schemaOk(service.output_schema) ? { outputSchema: service.output_schema } : {}),
    valid: schemaOk(service.input_schema) && schemaOk(service.output_schema),
    published: published !== undefined,
    stale: published !== undefined && published !== sourceSha256,
  };
}

export function listServices(config: ServiceConfig): ServiceInfo[] {
  const manifest = new Map(readManifest(config).map((entry) => [entry.slug, entry.source_sha256.toLowerCase()]));
  return entryDirs(servicesRoot(config))
    .map((dir) => readService(config, dir, manifest))
    .filter((service): service is ServiceInfo => service !== null)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export function findService(config: ServiceConfig, slug: string): ServiceInfo | null {
  if (!isServiceSlug(slug)) return null;
  const dir = serviceDir(config, slug);
  if (!existsSync(join(dir, "tool.ex"))) return null;
  const manifest = new Map(readManifest(config).map((entry) => [entry.slug, entry.source_sha256.toLowerCase()]));
  return readService(config, dir, manifest);
}

/** Publish the service's current source, or remove it from the manifest. */
export async function setPublished(config: ServiceConfig, slug: string, publish: boolean): Promise<ServiceInfo> {
  const service = findService(config, slug);
  if (!service) throw new ServiceError(404, `service ${slug} not found`);
  if (publish && !service.valid) {
    throw new ServiceError(422, `service ${slug} needs service.input_schema and service.output_schema in meta.json`);
  }
  const others = readManifest(config).filter((entry) => entry.slug !== slug);
  const next = publish ? [...others, { slug, source_sha256: service.sourceSha256 }] : others;
  await writeManifest(config, next);
  return { ...service, published: publish, stale: false };
}

export class ServiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
