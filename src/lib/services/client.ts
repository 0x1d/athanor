import React from "react";

/**
 * `@nshde/services` inside the preview sandbox. The loader gives each module
 * its own instance, scoped to the module's `export const capabilities`.
 * Calls go to `/api/services/:slug` with the token the IDE put in the preview URL.
 */

export interface ServiceRuntime {
  token: string | null;
  base: string;
}

let runtime: ServiceRuntime = { token: null, base: "" };

export function configureServiceRuntime(next: Partial<ServiceRuntime>): void {
  runtime = { ...runtime, ...next };
}

export class ServiceCallError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
    readonly status: number,
  ) {
    super(message);
    this.name = "ServiceCallError";
  }
}

export interface ServiceState<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  reload: () => void;
}

export interface ServicesModule {
  call: (slug: string, args?: Record<string, unknown>) => Promise<unknown>;
  useService: (slug: string, args?: Record<string, unknown>) => ServiceState<unknown>;
}

export function createServicesModule(capabilities: () => unknown): ServicesModule {
  const declared = (slug: string) => {
    const list = capabilities();
    return Array.isArray(list) && list.includes(`service:${slug}`);
  };

  async function call(slug: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!declared(slug)) {
      throw new ServiceCallError(`Declare "service:${slug}" in export const capabilities to call it`, "undeclared", 0);
    }
    if (!runtime.token) {
      throw new ServiceCallError("No service token. Mount the component from the IDE.", "missing_token", 0);
    }
    const res = await fetch(`${runtime.base}/api/services/${encodeURIComponent(slug)}`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${runtime.token}` },
      body: JSON.stringify(args ?? {}),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; error?: string; code?: string };
    if (!res.ok || data.ok === false) {
      throw new ServiceCallError(data.error ?? `service ${slug} failed (${res.status})`, data.code, res.status);
    }
    return data.result;
  }

  function useService(slug: string, args: Record<string, unknown> = {}): ServiceState<unknown> {
    const argsKey = JSON.stringify(args ?? {});
    const [nonce, setNonce] = React.useState(0);
    const [state, setState] = React.useState<Omit<ServiceState<unknown>, "reload">>({
      data: undefined,
      error: undefined,
      loading: true,
    });

    React.useEffect(() => {
      let live = true;
      setState((prev) => ({ ...prev, loading: true, error: undefined }));
      call(slug, JSON.parse(argsKey)).then(
        (data) => live && setState({ data, error: undefined, loading: false }),
        (error: unknown) =>
          live &&
          setState({ data: undefined, error: error instanceof Error ? error.message : String(error), loading: false }),
      );
      return () => {
        live = false;
      };
    }, [slug, argsKey, nonce]);

    const reload = React.useCallback(() => setNonce((n) => n + 1), []);
    return { ...state, reload };
  }

  return { call, useService };
}
