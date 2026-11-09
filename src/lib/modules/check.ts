import { transform } from "sucrase";

/** Imports the runtime loader resolves. Anything else fails in the preview. */
export const ALLOWED_IMPORTS = ["react", "react/jsx-runtime", "@nshde/services"] as const;

export const SERVICES_MODULE = "@nshde/services";

const SERVICE_SLUG = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

export interface CheckError {
  message: string;
  line?: number;
  column?: number;
}

export interface CheckResult {
  ok: boolean;
  errors: CheckError[];
  /** Declared `export const capabilities`, such as `service:weather`. */
  capabilities: string[];
}

export function isServiceSlug(value: string): boolean {
  return SERVICE_SLUG.test(value);
}

/** Same transform as the preview loader (`src/lib/modules/loader.ts`). */
export function compileModule(source: string): string {
  return transform(source, {
    transforms: ["jsx", "typescript", "imports"],
    jsxRuntime: "classic",
    production: true,
  }).code;
}

function lineAt(source: string, index: number): { line: number; column: number } {
  const before = source.slice(0, index);
  const line = before.split("\n").length;
  return { line, column: index - before.lastIndexOf("\n") };
}

/**
 * Reads `export const capabilities = ["service:a", ...]` without running the module.
 * The value must be an array literal of strings.
 */
export function parseCapabilities(source: string): { capabilities: string[]; error?: CheckError } {
  const match = /export\s+const\s+capabilities\b[^=]*=\s*/.exec(source);
  if (!match) return { capabilities: [] };
  const start = match.index + match[0].length;
  const at = lineAt(source, match.index);
  const rest = source.slice(start);
  const literal = /^\[([^\]]*)\]/.exec(rest);
  if (!literal) {
    return {
      capabilities: [],
      error: { message: "capabilities must be an array literal of strings", ...at },
    };
  }
  const body = literal[1];
  const strings = [...body.matchAll(/(["'`])((?:(?!\1)[^\\\n])*)\1/g)];
  const leftover = body.replace(/(["'`])((?:(?!\1)[^\\\n])*)\1/g, "").replace(/[\s,]/g, "");
  if (leftover) {
    return {
      capabilities: [],
      error: { message: "capabilities must contain only string literals", ...at },
    };
  }
  return { capabilities: strings.map((item) => item[2]) };
}

/** Service slugs a source passes as a literal first argument to `call` or `useService`. */
export function serviceCalls(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/\b(?:call|useService)\s*(?:<[^>()]*>)?\(\s*(["'`])([^"'`]+)\1/g)) {
    found.add(match[2]);
  }
  return [...found];
}

function syntaxError(error: unknown): CheckError {
  const message = error instanceof Error ? error.message : String(error);
  const position = /\((\d+):(\d+)\)/.exec(message);
  return position
    ? { message, line: Number(position[1]), column: Number(position[2]) + 1 }
    : { message };
}

/**
 * Compile-time check for a component: syntax (Sucrase), allowed imports,
 * a default export, and declared capabilities for every service it calls.
 */
export function checkModule(source: string): CheckResult {
  const errors: CheckError[] = [];
  let code: string;
  try {
    code = compileModule(source);
  } catch (error) {
    return { ok: false, errors: [syntaxError(error)], capabilities: [] };
  }

  // Sucrase drops imports that are never used, so read the source's specifiers too.
  const imports = new Set<string>();
  for (const match of code.matchAll(/require\((['"])([^'"]+)\1\)/g)) imports.add(match[2]);
  for (const match of source.matchAll(/^\s*(?:import|export)\b[^'"]*?\bfrom\s*(['"])([^'"]+)\1/gm)) imports.add(match[2]);
  for (const match of source.matchAll(/^\s*import\s*(['"])([^'"]+)\1/gm)) imports.add(match[2]);
  for (const id of imports) {
    if (!(ALLOWED_IMPORTS as readonly string[]).includes(id)) {
      errors.push({ message: `Import not allowed in the sandbox: ${id}. Allowed: ${ALLOWED_IMPORTS.join(", ")}` });
    }
  }
  if (/\bimport\s*\(/.test(source)) {
    errors.push({ message: "Dynamic import() is not allowed in the sandbox" });
  }
  if (!/exports\.default\s*=/.test(code)) {
    errors.push({ message: "The module must default-export a component" });
  }

  const { capabilities, error } = parseCapabilities(source);
  if (error) errors.push(error);
  for (const capability of capabilities) {
    const [kind, slug] = capability.split(/:(.*)/s);
    if (kind !== "service" || !slug || !isServiceSlug(slug)) {
      errors.push({ message: `Unknown capability "${capability}". Use "service:<name>".` });
    }
  }

  if (code.includes(SERVICES_MODULE)) {
    for (const slug of serviceCalls(source)) {
      if (!capabilities.includes(`service:${slug}`)) {
        errors.push({ message: `Calls service "${slug}" without declaring "service:${slug}" in capabilities` });
      }
    }
  }

  return { ok: errors.length === 0, errors, capabilities };
}

/** Service slugs a component may call, from its declared capabilities. */
export function serviceScopes(source: string): string[] {
  return parseCapabilities(source)
    .capabilities.filter((capability) => capability.startsWith("service:"))
    .map((capability) => capability.slice("service:".length))
    .filter(isServiceSlug);
}
