---
name: canvas-60fps-viz
description: >-
  Engineering runbook for 60fps HTML5 Canvas Squarified Treemap and Zoomable
  Sunburst visualizations in mac-sweep. Use when building, styling, optimizing,
  or testing Canvas layouts, DPR scaling, hit-testing, or zoom transitions.
---

# 60fps HTML5 Canvas Visualization Runbook

## 1. Zero-DOM-Bloat Rule
Never render Treemap rectangles or Sunburst sectors as HTML `<div>` or `<svg>` elements. Render all geometry onto an HTML5 `<canvas>` backed by flat typed/plain arrays computed via `d3-hierarchy`.

## 2. HiDPI & ResizeObserver Discipline
- Observe the container with `ResizeObserver`.
- Size the canvas backing store to `Math.floor(width * dpr)` by `Math.floor(height * dpr)` where `dpr = Math.min(window.devicePixelRatio || 1, 3)`.
- Apply `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` before drawing so all geometry math stays in CSS pixels.

## 3. Squarified Treemap (`src/lib/viz/treemapLayout.ts`)
- Build hierarchy from `SubtreeNodeDto` using `d3-hierarchy`'s `hierarchy()` + `treemap().tile(treemapSquarify).round(true)`.
- Weight nodes by `physicalBytes` (ignoring zero-byte nodes in area calculation, or clamping display-only fallback safely).
- Cull any cell where `(x1 - x0) < 1.5 || (y1 - y0) < 1.5` before emitting into the draw list.
- Draw crisp 1px borders separating depth levels; only render clipped text labels when `width >= 48 && height >= 18` (using `ctx.save(); ctx.beginPath(); ctx.rect(...); ctx.clip()`).
- **Hit-testing:** Iterate visible cells from deepest depth to shallowest (or reverse draw order) checking `x >= x0 && x <= x1 && y >= y0 && y <= y1`.

## 4. Zoomable Sunburst (`src/lib/viz/sunburstLayout.ts`)
- Compute polar layout via `d3-hierarchy`'s `partition().size([2 * Math.PI, maxRadius])`.
- Reserve a center hub (`innerHoleRadius = maxRadius * 0.22`) showing current root name + physical size; clicking the hub navigates up to the parent directory.
- Cull arcs whose angular sweep `(x1 - x0) < 0.004` radians.
- **Polar hit-testing:** Compute `dx = x - cx`, `dy = y - cy`, `r = Math.hypot(dx, dy)`. If `r < innerHoleRadius`, return `{ kind: "center" }`. Otherwise compute normalized angle `theta = (Math.atan2(dy, dx) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI)` (matching `-Math.PI / 2` top-12-o'clock start) and match against ring radial bounds & angular interval.
- Animate drill-down transitions smoothly (~220ms ease-out cubic) using `requestAnimationFrame`, stopping the loop immediately once animation settles (0% idle CPU).

## 5. Dirty-Flag Rendering & Frame Budget
- Do NOT run an unbounded `requestAnimationFrame` loop. Schedule a single frame only when state changes (subtree, viewport, hover, selection, theme, or active zoom transition).
- Validate performance with an automated Vitest benchmark generating a 50,000-node tree: layout computation + culling + hit-testing must stay well under interactive frame targets.
