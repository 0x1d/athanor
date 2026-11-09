# nshde

**nshde** is a recursive IDE inspired by [Native Shell (NSH)](https://nsh.dev/): an environment that can extend itself at runtime. You describe a module to an agent; the agent writes an NSH-style shell component, persists it to configurable storage, and the IDE hot-mounts it in the runtime preview—similar to NSH’s post-release TSX modules and signed packages, adapted for web development.

## Repository

- **GitHub:** [github.com/0x1d/nshde](https://github.com/0x1d/nshde)
- **Origin (Cursor):** [origin.cursor.com/0x1d/nshde](https://origin.cursor.com/0x1d/nshde)

## Features

- **NSH app shell** — Zed-style `DockArea`: agents on the left (sessions and conversation tabs), editor in the center, object tree on the right, runtime along the bottom. Collapsed panes leave an activity rail.
- **Object tree** — components and files under `components/`, developed through nshde
- **Code editor** — `nsh/base` `Editor` with syntax highlighting for TSX/JSON
- **Agent panel** — the [alchemist](https://github.com/0x1d/alchemist) Claude host as a sidecar, streamed into the conversation; Architect, Implementer, or Reviewer chosen from a menu on the composer
- **Services** — backend logic as alchemist Elixir codex entries; components call published services through `@nshde/services` and a call-only BEAM gateway
- **Configurable storage** — `fs` (default, `.nshde-data/`), `memory`, or `s3` (AWS SDK hook; falls back to in-memory demo when creds are absent)
- **Runtime loading** — `.nsh.tsx` modules compiled with Sucrase in a `/preview` sandbox; `.wasm` modules instantiated with host imports

## Quick start

Requires [Bun](https://bun.com/) 1.4+ and the [NSH CLI](https://nsh.dev/docs/installation).

**Install NSH** (if `bun run check:nsh` fails):

```bash
curl -fsSL https://nsh.dev/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"   # add to ~/.bashrc / ~/.zshrc to persist
bun run check:nsh                      # should print nsh version
```

`dev:ui` uses `scripts/nsh-run.sh`, which looks for `nsh` on `PATH`, then `~/.local/bin/nsh`, then `~/.nsh/bin/nsh` (override with `NSH_BIN`).

```bash
bun install
bun run dev:api    # terminal 1 — API on http://localhost:43123
bun run dev:ui     # terminal 2 — NSH IDE in the browser (nsh dev server)
```

Or both:

```bash
bun run dev
```

Open the URL printed by `nsh run` (typically `http://127.0.0.1:8790/`). The API stays on port `43123` unless you set `PORT`.

### Agent and services

The agent is the alchemist nshde host (see its `hosts/nshde/README.md`). Run it beside nshde:

```bash
# in the alchemist checkout (Node 24+, Elixir; Claude credentials for the Agent SDK)
NSHDE_API_URL=http://127.0.0.1:43123 npm run serve:nshde      # sidecar on :43124

# in nshde
NSHDE_AGENT_URL=http://127.0.0.1:43124 ALCHEMIST_DIR=../alchemist bun run dev:api
```

Ask for a component and a service. The component hot-mounts in the preview; publish the service from the explorer's `services` folder so the component can call it.

```bash
bun run test   # server tests (bun test src)
```

Production API:

```bash
bun run start
```

(`bun run build` bundles to `dist/` for local experiments; production and Docker use `src/server.ts` so static paths like `public/` resolve correctly.)

### Deploy on Koyeb

This app **cannot** use Koyeb’s default Node.js buildpacks: it depends on **Bun** (`bun.lock`, no `package-lock.json`) and `Bun.serve`.

1. Push this repository (includes the root `Dockerfile`).
2. Create or update the Koyeb Service with **Builder: Dockerfile** (not Buildpack).
3. Leave the run command empty so the image `CMD` runs `bun src/server.ts` (API + packaged NSH web UI on the same port).
4. Set **`PORT`** if needed — Koyeb injects it automatically; the server reads `process.env.PORT`.
5. Optional: `NSHDE_STORAGE=memory` on ephemeral instances (default `fs` uses `.nshde-data/` inside the container).

The Docker build runs `nsh package . --target web` and serves `.nsh/out/nshde` at `/`. If you only see plain text asking you to run `nsh run App.tsx`, the image was built without the NSH bundle (redeploy with the Dockerfile builder, not API-only `bun start` on a buildpack).

CLI example:

```bash
koyeb app init nshde \
  --git github.com/0x1d/nshde \
  --git-branch main \
  --git-builder docker
```

Health check: HTTP on `/` (IDE when packaged) or `/api/config`.

Local production smoke test:

```bash
bun run build:web
bun run start
```

Package the NSH UI separately for static-only hosting (CDN without the Bun API):

```bash
nsh package App.tsx --target web
```

### Environment

| Variable | Description |
|----------|-------------|
| `PORT` | HTTP port for the Bun API (default `43123`) |
| `NSHDE_STORAGE` | `fs` (default), `memory`, or `s3` |
| `NSHDE_S3_BUCKET` | S3 bucket name |
| `NSHDE_S3_PREFIX` | Key prefix inside the bucket |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Required for real S3 (not yet wired; stub throws with creds) |

## Workflow

1. Pick an agent and prompt, e.g. *“Build a todo list module”*.
2. The agent writes `components/<slug>.nsh.tsx` to storage.
3. The editor opens the new file; the runtime preview mounts it automatically.
4. Click **run** on any module in the object tree to remount, or edit and **Save** to hot-reload.

## Architecture

The **IDE shell** is an NSH TSX app (`App.tsx`, `nsh run --target web`). The **Bun server** serves `/api/*`, CORS for the dev host, and `/preview` (React sandbox iframe inside `WebView`).

```
┌────┬──────────┬─────────┬──────────┬────────┬────┐
│    │ Sessions │  Chat   │  Editor  │  Tree  │    │
│rail│          │  tabs   │          │        │rail│
│    │          │         ├──────────┤        │    │
│    │          │         │ Runtime  │        │    │
└────┴──────────┴─────────┴──────────┴────────┴────┘
         │            │           │
         ▼            ▼           ▼
   /api/agents   /api/storage   /preview
         │            │
         └─────┬──────┘
               ▼
   StorageProvider (fs | memory | s3)
```

User modules in the preview still use a deliberate React sandbox today. The chrome uses NSH gallery components (`DockArea`, `Editor`, `Menu`, chat, `Collapsible`). This nsh 0.3.0 build has no `Toolbar` export, so the bars are rows of `Button`s.

## Relation to NSH

[NSH](https://nsh.dev/) targets native platforms with Rust/TSX, signed `.nshpkg` packages, and QuickJS sandboxes. **nshde** models the same loop for IDE self-development on the web: agents → stored modules → runtime integration. A production path would add signing, capability tokens, and compiling user modules with the real `nsh` toolchain for multi-target packaging.

## License

MIT
