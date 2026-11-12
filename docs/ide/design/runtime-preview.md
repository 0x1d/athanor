---
id: crucible/nshde/ide/design/runtime-preview
title: Runtime Preview
type: DES
owner: crucible/nshde/ide
status: Draft
date: 2026-11-11
depends: [crucible/nshde/ide/design]
related: []
planned: []
---

# Runtime Preview

Make a mounted TSX module actually run inside the runtime WebView, and give Runtime its own mark.

## Dependency graph

```mermaid
flowchart TD
  sandbox[Classic preview script in the opaque WebView]
  mount[Phone mount opens the runtime]
  icon[Play mark on the runtime tab]
  collapse[Collapse glyph at the right of that tab row]
  sandbox --> mount
  icon --> collapse
```

## Slices

1. The web WebView sandboxes a same-origin page without `allow-same-origin`. The preview was a module script, which that opaque origin refuses, so the pane stayed blank wherever the IDE and the API share an origin. Serve the preview as a classic script plus its stylesheet.
2. Mounting a module on a phone opens the runtime section. The preview fills that section.
3. The runtime tab shows a play mark. The collapse glyph, which used to sit in the tab, sits at the right edge of that tab row.

## Done when

- A sandboxed same-origin preview frame renders the welcome module.
- On a 390-point viewport, mounting a module leaves the explorer and shows the runtime.
- On a 1280-point viewport, Collapse runtime hides the pane and leaves the rail.
