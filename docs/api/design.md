---
id: crucible/nshde/api/design
title: Design
type: DES
owner: crucible/nshde/api
status: Draft
date: 2026-11-11
depends: []
related: [crucible/nshde/ide/design]
planned: []
---

# Design

The API's design is recorded as sub-documents. Each specifies a planned change, declared in its front matter with its dependencies.

| Sub-document | Content | State |
| --- | --- | --- |
| [crucible/nshde/api/design/alchemist-integration](design/alchemist-integration.md) | The alchemist Claude host as the nshde agent: sidecar, component entries, service gateway and binding | All slices done, not closed |
| [crucible/nshde/api/design/free-tier-deployment](design/free-tier-deployment.md) | Vercel, Supabase and Koyeb free tiers, plus a GitHub repository for the agent's code | Planned |
| [crucible/nshde/api/design/access-control](design/access-control.md) | Supabase Auth in front of the API; the preview sandbox as the boundary for agent-written code | Planned |
| [crucible/nshde/api/design/agent-sandbox](design/agent-sandbox.md) | The agent on demand in a Vercel Sandbox | Planned |
