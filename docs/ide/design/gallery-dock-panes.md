---
id: crucible/nshde/ide/design/gallery-dock-panes
title: Gallery Dock Panes
type: DES
owner: crucible/nshde/ide
status: Draft
date: 2026-11-11
depends: [crucible/nshde/ide/design]
related: []
planned: []
---

# Gallery Dock Panes

Match the gallery Dock example for the left and right docks, collapse the runtime to a tab-height rail, and restyle the agent panel after the gallery AI chat.

## Dependency graph

```mermaid
flowchart TD
  chrome[Dock chrome like examples/gallery Dock]
  rail[Bottom rail at tab height]
  agent[Agent panel like the AI chat example]
  chrome --> rail
  chrome --> agent
```

## Slices

1. Left and right docks use the gallery tab and `renderDock` header. Hide closes the dock. The title bar toggles them open again.
2. The bottom dock closes instead of shrinking. DockArea keeps an open dock at least 100 points, so the collapsed runtime is an `h-9` tab rail under the area, the same height as a gallery tab.
3. The agent panel uses the AI chat transcript, suggestion chips, segmented agent control, and rounded composer.

## Done when

- Left and right panes show gallery tabs and a Hide strip, and reopen from the title bar.
- Collapsing the runtime leaves only that tab rail.
- The agent panel follows the AI chat example and still generates a module.
