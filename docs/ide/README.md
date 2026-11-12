---
id: crucible/nshde/ide
title: IDE
type: manifest
owner: crucible/nshde
profile: app
status: active
summary: The IDE shell: docks, editor, agent panel, explorer and runtime preview, built with NSH
code: .
depends: [crucible/nshde/api]
implements: []
documents: [crucible/nshde/ide/design]
date: 2026-11-11
---

# IDE

The IDE shell in the browser: NSH TSX (`App.tsx`, `src/client`, `src/nshde`). It talks to the API for storage, preview and agent turns.

| Document | Title |
| --- | --- |
| [crucible/nshde/ide/design](design.md) | Design, one sub-document per part of the shell |

Not written yet (crucible/nshde/OI-01): requirements, ux, verification.

## Dependencies

| Component | Uses | Interface |
| --- | --- | --- |
| crucible/nshde/api | Storage, preview sandbox, agent sessions | Not written yet (crucible/nshde/OI-01) |
