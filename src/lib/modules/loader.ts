import React from "react";
import { compileModule, SERVICES_MODULE } from "./check";
import { createServicesModule } from "../services/client";

export type LoadedModule =
  | { kind: "tsx"; component: React.ComponentType; path: string }
  | { kind: "wasm"; instance: WebAssembly.Instance; path: string; renderHtml: () => string };

export async function loadTsxModule(
  path: string,
  source: string,
): Promise<React.ComponentType> {
  const code = compileModule(source);

  const module = { exports: {} as { default?: React.ComponentType; capabilities?: unknown } };
  // Scoped to this module's own `export const capabilities`, read at call time.
  const services = createServicesModule(() => module.exports.capabilities);
  const require = (id: string): unknown => {
    if (id === "react") return React;
    if (id === "react/jsx-runtime") return React;
    if (id === SERVICES_MODULE) return services;
    throw new Error(`Import not allowed in sandbox: ${id}`);
  };

  const fn = new Function("require", "module", "exports", "React", code);
  fn(require, module, module.exports, React);

  if (!module.exports.default) {
    throw new Error(`Module ${path} must default-export a component`);
  }
  return module.exports.default;
}

export async function loadWasmModule(
  path: string,
  bytes: Uint8Array,
): Promise<{ instance: WebAssembly.Instance; renderHtml: () => string }> {
  const memorySlot: { mem?: WebAssembly.Memory } = {};
  const imports = {
    nsh_host: {
      log: (ptr: number, len: number) => {
        if (!memorySlot.mem) return;
        const view = new Uint8Array(memorySlot.mem.buffer, ptr, len);
        console.info("[wasm]", new TextDecoder().decode(view));
      },
    },
  };
  const instantiated = await WebAssembly.instantiate(bytes, imports);
  const instance = (
    "instance" in instantiated ? instantiated.instance : instantiated
  ) as WebAssembly.Instance;
  memorySlot.mem = instance.exports.memory as WebAssembly.Memory | undefined;

  const render = instance.exports.render as (() => number) | undefined;
  const memory = memorySlot.mem;

  return {
    instance,
    renderHtml: () => {
      if (!render || !memory) {
        return `<div class="p-4 text-sm text-zinc-400">WASM module loaded (${path}) — no render export</div>`;
      }
      const ptr = render();
      if (ptr <= 0) return "";
      const view = new Uint8Array(memory.buffer, ptr, 512);
      const len = view.indexOf(0);
      return new TextDecoder().decode(view.subarray(0, len > 0 ? len : view.length));
    },
  };
}

export async function loadModuleFromStorage(
  path: string,
  content: string | Uint8Array,
): Promise<LoadedModule> {
  if (path.endsWith(".wasm")) {
    const bytes = content instanceof Uint8Array ? content : new TextEncoder().encode(content);
    const { instance, renderHtml } = await loadWasmModule(path, bytes);
    return { kind: "wasm", instance, path, renderHtml };
  }

  const source = typeof content === "string" ? content : new TextDecoder().decode(content);
  const component = await loadTsxModule(path, source);
  return { kind: "tsx", component, path };
}
