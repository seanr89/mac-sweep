import {
  treemap,
  treemapSquarify,
  type HierarchyRectangularNode,
} from "d3-hierarchy";
import type { FileCategory, NodeKey, SubtreeNodeDto } from "../ipc/types";
import { buildWeightedHierarchy, isSyntheticOtherId } from "./hierarchyUtils";
import {
  formatVizBytes,
  getCategoryFill,
  getVizSurfacePalette,
  type VizTheme,
} from "./palette";

export interface TreemapRect {
  id: NodeKey;
  name: string;
  path: string;
  isDir: boolean;
  isHardlinkDup: boolean;
  isSyntheticOther: boolean;
  hasVisibleChildren: boolean;
  physicalBytes: number;
  logicalBytes: number;
  fileCount: number;
  category: FileCategory;
  depth: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
  height: number;
  percentOfRoot: number;
}

export interface TreemapLayoutOptions {
  paddingOuter?: number;
  paddingInner?: number;
  headerDepth1Height?: number;
  headerDepth2Height?: number;
  minCellSize?: number;
}

export interface TreemapRenderState {
  theme: VizTheme;
  hoveredId: NodeKey | null;
  selectedId: NodeKey | null;
}

const DEFAULT_MIN_CELL_SIZE = 1.5;
const LABEL_MIN_WIDTH = 48;
const LABEL_MIN_HEIGHT = 18;
const SUBTITLE_MIN_WIDTH = 64;
const SUBTITLE_MIN_HEIGHT = 34;

/**
 * Compute a culled, depth-ordered flat array of `TreemapRect` cells using
 * `d3-hierarchy`'s squarified treemap algorithm weighted by `physicalBytes`.
 */
export function computeTreemapLayout(
  subtree: SubtreeNodeDto,
  width: number,
  height: number,
  options: TreemapLayoutOptions = {},
): TreemapRect[] {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < DEFAULT_MIN_CELL_SIZE ||
    height < DEFAULT_MIN_CELL_SIZE
  ) {
    return [];
  }

  const paddingOuter = options.paddingOuter ?? 2;
  const paddingInner = options.paddingInner ?? 1.5;
  const headerDepth1Height = options.headerDepth1Height ?? 18;
  const headerDepth2Height = options.headerDepth2Height ?? 15;
  const minCellSize = options.minCellSize ?? DEFAULT_MIN_CELL_SIZE;

  const root = buildWeightedHierarchy(subtree);
  const totalValue = root.value ?? 0;
  if (!Number.isFinite(totalValue) || totalValue <= 0) {
    return [];
  }

  const layout = treemap<SubtreeNodeDto>()
    .tile(treemapSquarify)
    .size([width, height])
    .round(true)
    .paddingOuter(paddingOuter)
    .paddingInner(paddingInner)
    .paddingTop((node) => {
      if (!node.children || node.children.length === 0) {
        return 0;
      }
      if (node.depth === 0) {
        return paddingOuter;
      }
      if (node.depth === 1) {
        return headerDepth1Height;
      }
      if (node.depth === 2) {
        return headerDepth2Height;
      }
      return 1;
    });

  const laidOut = layout(root);
  const rootPhysicalBytes =
    subtree.physicalBytes > 0 ? subtree.physicalBytes : totalValue;

  const hasChildren = Boolean(laidOut.children && laidOut.children.length > 0);
  const rects: TreemapRect[] = [];

  // Breadth-first traversal emits cells in ascending depth order so nested
  // children always draw on top of parent containers and hit-testing can scan
  // in reverse order (deepest visible cell first).
  const queue: HierarchyRectangularNode<SubtreeNodeDto>[] = hasChildren
    ? [...(laidOut.children ?? [])]
    : [laidOut];

  let head = 0;
  while (head < queue.length) {
    const node = queue[head];
    head += 1;
    if (!node) continue;

    const val = node.value ?? 0;
    if (!Number.isFinite(val) || val <= 0) {
      continue;
    }

    const x0 = node.x0;
    const y0 = node.y0;
    const x1 = node.x1;
    const y1 = node.y1;
    if (
      !Number.isFinite(x0) ||
      !Number.isFinite(y0) ||
      !Number.isFinite(x1) ||
      !Number.isFinite(y1)
    ) {
      continue;
    }

    const cellWidth = x1 - x0;
    const cellHeight = y1 - y0;
    if (cellWidth < minCellSize || cellHeight < minCellSize) {
      continue;
    }

    // Check whether any child of this node will itself survive culling
    let hasVisibleChildren = false;
    const nodeChildren = node.children;
    if (nodeChildren && nodeChildren.length > 0) {
      for (let i = 0; i < nodeChildren.length; i += 1) {
        const child = nodeChildren[i];
        if (!child) continue;
        const cw = child.x1 - child.x0;
        const ch = child.y1 - child.y0;
        if (
          (child.value ?? 0) > 0 &&
          Number.isFinite(cw) &&
          Number.isFinite(ch) &&
          cw >= minCellSize &&
          ch >= minCellSize
        ) {
          hasVisibleChildren = true;
          queue.push(child);
        }
      }
    }

    const data = node.data;
    const physicalBytes =
      Number.isFinite(data.physicalBytes) && data.physicalBytes > 0
        ? data.physicalBytes
        : val;

    rects.push({
      id: data.id,
      name: data.name,
      path: data.path,
      isDir: data.isDir,
      isHardlinkDup: data.isHardlinkDup,
      isSyntheticOther: isSyntheticOtherId(data.id),
      hasVisibleChildren,
      physicalBytes,
      logicalBytes: Number.isFinite(data.logicalBytes)
        ? data.logicalBytes
        : physicalBytes,
      fileCount: data.fileCount,
      category: data.category,
      depth: node.depth,
      x0,
      y0,
      x1,
      y1,
      width: cellWidth,
      height: cellHeight,
      percentOfRoot:
        rootPhysicalBytes > 0 ? (physicalBytes / rootPhysicalBytes) * 100 : 0,
    });
  }

  return rects;
}

/**
 * Hit-test CSS pixel coordinates `(x, y)` against the culled treemap rects.
 * Scans in reverse draw order so the deepest visible cell wins.
 */
export function hitTestTreemap(
  rects: readonly TreemapRect[],
  x: number,
  y: number,
): TreemapRect | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  for (let i = rects.length - 1; i >= 0; i -= 1) {
    const rect = rects[i];
    if (!rect) continue;
    if (x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1) {
      return rect;
    }
  }

  return null;
}

const FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif';

/**
 * Render the squarified treemap onto an HTML5 Canvas 2D context.
 * Expects `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` to have been applied by the caller.
 */
export function renderTreemapCanvas(
  ctx: CanvasRenderingContext2D,
  rects: readonly TreemapRect[],
  width: number,
  height: number,
  state: TreemapRenderState,
): void {
  const surface = getVizSurfacePalette(state.theme);

  ctx.fillStyle = surface.canvasBg;
  ctx.fillRect(0, 0, width, height);

  if (rects.length === 0) {
    return;
  }

  let hoveredRect: TreemapRect | null = null;
  let selectedRect: TreemapRect | null = null;

  ctx.lineWidth = 1;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  for (let i = 0; i < rects.length; i += 1) {
    const rect = rects[i];
    if (!rect) continue;

    if (state.hoveredId !== null && rect.id === state.hoveredId) {
      hoveredRect = rect;
    }
    if (state.selectedId !== null && rect.id === state.selectedId) {
      selectedRect = rect;
    }

    ctx.fillStyle = getCategoryFill(
      rect.category,
      rect.depth,
      state.theme,
      rect.isSyntheticOther,
    );
    ctx.fillRect(rect.x0, rect.y0, rect.width, rect.height);

    // Subtle dark tint on container headers so nested children pop cleanly
    if (rect.hasVisibleChildren && rect.depth <= 2 && rect.height >= 16) {
      const stripHeight = rect.depth === 1 ? 18 : 15;
      ctx.fillStyle = surface.containerHeaderBg;
      ctx.fillRect(
        rect.x0,
        rect.y0,
        rect.width,
        Math.min(stripHeight, rect.height),
      );
    }

    // Crisp 1px border aligned on half-pixel boundaries
    ctx.strokeStyle = surface.cellBorder;
    ctx.strokeRect(
      rect.x0 + 0.5,
      rect.y0 + 0.5,
      Math.max(0, rect.width - 1),
      Math.max(0, rect.height - 1),
    );

    // Only draw clipped labels when the cell has comfortable room
    if (rect.width >= LABEL_MIN_WIDTH && rect.height >= LABEL_MIN_HEIGHT) {
      drawCellLabel(ctx, rect, surface);
    }
  }

  // Hover highlight drawn on top of siblings so border is never clipped
  if (hoveredRect) {
    ctx.fillStyle = surface.hoverOverlay;
    ctx.fillRect(
      hoveredRect.x0,
      hoveredRect.y0,
      hoveredRect.width,
      hoveredRect.height,
    );
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = surface.hoverStroke;
    ctx.strokeRect(
      hoveredRect.x0 + 0.75,
      hoveredRect.y0 + 0.75,
      Math.max(0, hoveredRect.width - 1.5),
      Math.max(0, hoveredRect.height - 1.5),
    );
  }

  // Selected ring drawn last with high-contrast macOS accent outline
  if (selectedRect) {
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = surface.selectedStroke;
    ctx.strokeRect(
      selectedRect.x0 + 1.25,
      selectedRect.y0 + 1.25,
      Math.max(0, selectedRect.width - 2.5),
      Math.max(0, selectedRect.height - 2.5),
    );
    if (selectedRect.width >= 10 && selectedRect.height >= 10) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = surface.selectedOuterRing;
      ctx.strokeRect(
        selectedRect.x0 + 3,
        selectedRect.y0 + 3,
        Math.max(0, selectedRect.width - 6),
        Math.max(0, selectedRect.height - 6),
      );
    }
  }
}

function drawCellLabel(
  ctx: CanvasRenderingContext2D,
  rect: TreemapRect,
  surface: ReturnType<typeof getVizSurfacePalette>,
): void {
  const padX = 5;
  const padY = rect.hasVisibleChildren ? 3 : 4;
  const maxClipHeight = rect.hasVisibleChildren
    ? Math.min(rect.height - 2, rect.depth === 1 ? 17 : 14)
    : rect.height - 4;

  if (maxClipHeight < 12) {
    return;
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(
    rect.x0 + 2,
    rect.y0 + 1,
    Math.max(0, rect.width - 4),
    maxClipHeight,
  );
  ctx.clip();

  if (rect.hasVisibleChildren) {
    // Compact single-line header for container directories
    ctx.font = `600 10.5px ${FONT_FAMILY}`;
    ctx.fillStyle = surface.labelText;
    const text =
      rect.width >= 115
        ? `${rect.name} · ${formatVizBytes(rect.physicalBytes)}`
        : rect.name;
    ctx.fillText(text, rect.x0 + padX, rect.y0 + padY);
  } else {
    // Leaf / unexpanded folder tile
    ctx.font = `${rect.isDir ? 600 : 500} 11px ${FONT_FAMILY}`;
    ctx.fillStyle = surface.labelText;
    ctx.fillText(rect.name, rect.x0 + padX, rect.y0 + padY);

    if (
      rect.width >= SUBTITLE_MIN_WIDTH &&
      rect.height >= SUBTITLE_MIN_HEIGHT
    ) {
      ctx.font = `400 10px ${FONT_FAMILY}`;
      ctx.fillStyle = surface.labelSubtext;
      ctx.fillText(
        formatVizBytes(rect.physicalBytes),
        rect.x0 + padX,
        rect.y0 + padY + 14,
      );
    }
  }

  ctx.restore();
}
