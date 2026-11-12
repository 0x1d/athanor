---
id: crucible/nshde/api
title: API
type: manifest
owner: crucible/nshde
profile: service
status: active
summary: The Bun server: /api routes for storage, the preview sandbox and the agent
code: src/server.ts
depends: []
implements: []
documents: [crucible/nshde/api/design]
date: 2026-11-11
---

# API

The Bun server (`src/server.ts`, `src/lib`). It exposes `/api/*`, serves the React sandbox at `/preview` and starts agent turns through the alchemist sidecar.

| Document | Title |
| --- | --- |
| [crucible/nshde/api/design](design.md) | Design: the alchemist integration and the planned access control, agent sandbox and deployment |

Not written yet (crucible/nshde/OI-01): requirements, architecture, interfaces, security, operations, verification.
