/** @jsxImportSource react */
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import "@/client/globals.css";
import { loadModuleFromStorage, type LoadedModule } from "@/lib/modules/loader";
import { configureServiceRuntime } from "@/lib/services/client";

// The IDE passes the service token in the fragment, which is not sent to the server or logged.
configureServiceRuntime({ token: new URLSearchParams(window.location.hash.slice(1)).get("token") });

function RuntimePreview() {
  const params = new URLSearchParams(window.location.search);
  const modulePath = params.get("path");
  const revision = params.get("r") ?? "0";
  const [loaded, setLoaded] = useState<LoadedModule | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!modulePath) {
      setLoaded(null);
      setError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const isWasm = modulePath.endsWith(".wasm");
        let content: string | Uint8Array;
        if (isWasm) {
          const res = await fetch(`/api/storage?path=${encodeURIComponent(modulePath)}`, {
            cache: "no-store",
          });
          if (!res.ok) throw new Error("Failed to load WASM from storage");
          content = new Uint8Array(await res.arrayBuffer());
        } else {
          const res = await fetch(`/api/storage?path=${encodeURIComponent(modulePath)}`, {
            cache: "no-store",
          });
          const data = (await res.json()) as { content: string };
          content = data.content;
        }
        const mod = await loadModuleFromStorage(modulePath, content);
        if (!cancelled) setLoaded(mod);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Load failed");
          setLoaded(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [modulePath, revision]);

  if (!modulePath) {
    return (
      <p style={{ padding: 16, color: "#a1a1aa", fontFamily: "system-ui", fontSize: 14 }}>
        Select a module to preview.
      </p>
    );
  }

  if (error) {
    return (
      <p style={{ padding: 16, color: "#fca5a5", fontFamily: "system-ui", fontSize: 14 }}>{error}</p>
    );
  }

  if (!loaded) {
    return (
      <p style={{ padding: 16, color: "#a1a1aa", fontFamily: "system-ui", fontSize: 14 }}>Loading module…</p>
    );
  }

  if (loaded.kind === "tsx") {
    return (
      <div className="nsh-runtime-root" style={{ padding: 16 }}>
        <loaded.component />
      </div>
    );
  }

  return (
    <div
      className="nsh-runtime-root"
      style={{ padding: 16, color: "#fafafa" }}
      dangerouslySetInnerHTML={{ __html: loaded.renderHtml() }}
    />
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<RuntimePreview />);
}
