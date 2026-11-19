import { partition, type HierarchyRectangularNode } from "d3-hierarchy";
import type { FileCategory, NodeKey, SubtreeNodeDto } from "../ipc/types";
import { buildWeightedHierarchy, isSyntheticOtherId } from "./hierarchyUtils";
import {
  formatVizBytes,
  getCategoryFill,
  getVizSurfacePalette,
  type VizTheme,
} from "./palette";

export const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const DEFAULT_INNER_HOLE_RATIO = 0.24;
const DEFAULT_MIN_ANGLE_RAD = 0.004;
const DEFAULT_PADDING = 14;

export interface SunburstArc {
  id: NodeKey;
  name: string;
  path: string;
  isDir: boolean;
  isHardlinkDup: boolean;
  isSyntheticOther: boolean;
  physicalBytes: number;
  logicalBytes: number;
  fileCount: number;
  category: FileCategory;
  depth: number;
  /** Start angle in radians `[0, 2π]` measured clockwise from 12 o'clock. */
  startAngle: number;
  /** End angle in radians `[0, 2π]` measured clockwise from 12 o'clock. */
  endAngle: number;
  innerRadius: number;
  outerRadius: number;
  percentOfRoot: number;
}

export interface SunburstCenterInfo {
  id: NodeKey;
  name: string;
  path: string;
  physicalBytes: number;
  logicalBytes: number;
  fileCount: number;
  cx: number;
  cy: number;
  innerHoleRadius: number;
  maxRadius: number;
  canNavigateUp: boolean;
}

export interface SunburstLayoutResult {
  arcs: SunburstArc[];
  cx: number;
  cy: number;
  maxRadius: number;
  innerHoleRadius: number;
  centerInfo: SunburstCenterInfo;
}

export interface SunburstLayoutOptions {
  padding?: number;
  innerHoleRatio?: number;
  minAngleRad?: number;
}

export interface SunburstRenderState {
  theme: VizTheme;
  hoveredId: NodeKey | null;
  selectedId: NodeKey | null;
  isCenterHovered: boolean;
}

export type SunburstHitResult =
  | { kind: "center" }
  | { kind: "arc"; arc: SunburstArc }
  | null;

/**
 * Compute polar sunburst arcs via `d3-hierarchy`'s `partition().size([2π, 1])`
 * mapped into `[innerHoleRadius, maxRadius]` around `(cx, cy)`.
 */
export function computeSunburstLayout(
  subtree: SubtreeNodeDto,
  width: number,
  height: number,
  options: SunburstLayoutOptions = {},
): SunburstLayoutResult {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 0;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 0;
  const padding = options.padding ?? DEFAULT_PADDING;
  const innerHoleRatio = options.innerHoleRatio ?? DEFAULT_INNER_HOLE_RATIO;
  const minAngleRad = options.minAngleRad ?? DEFAULT_MIN_ANGLE_RAD;

  const cx = safeWidth / 2;
  const cy = safeHeight / 2;
  const maxRadius = Math.max(0, Math.min(safeWidth, safeHeight) / 2 - padding);
  const innerHoleRadius = maxRadius * innerHoleRatio;

  const baseCenterInfo: SunburstCenterInfo = {
    id: subtree.id,
    name: subtree.name,
    path: subtree.path,
    physicalBytes: Number.isFinite(subtree.physicalBytes)
      ? Math.max(0, subtree.physicalBytes)
      : 0,
    logicalBytes: Number.isFinite(subtree.logicalBytes)
      ? Math.max(0, subtree.logicalBytes)
      : 0,
    fileCount: subtree.fileCount,
    cx,
    cy,
    innerHoleRadius,
    maxRadius,
    canNavigateUp: false,
  };

  if (maxRadius <= 2) {
    return {
      arcs: [],
      cx,
      cy,
      maxRadius,
      innerHoleRadius,
      centerInfo: baseCenterInfo,
    };
  }

  const root = buildWeightedHierarchy(subtree);
  const totalValue = root.value ?? 0;
  if (!Number.isFinite(totalValue) || totalValue <= 0) {
    return {
      arcs: [],
      cx,
      cy,
      maxRadius,
      innerHoleRadius,
      centerInfo: baseCenterInfo,
    };
  }

  const partitionLayout = partition<SubtreeNodeDto>().size([TWO_PI, 1]);
  const partitioned = partitionLayout(root);

  const rootChildren = partitioned.children;
  if (!rootChildren || rootChildren.length === 0) {
    return {
      arcs: [],
      cx,
      cy,
      maxRadius,
      innerHoleRadius,
      centerInfo: baseCenterInfo,
    };
  }

  // Root occupies [0, rootY1] in normalized radial space; children occupy [rootY1, 1].
  const rootY1 = partitioned.y1;
  const normalizedRadialSpan = Math.max(1e-6, 1 - rootY1);
  const usableRadialPixels = Math.max(0, maxRadius - innerHoleRadius);
  const rootPhysicalBytes =
    subtree.physicalBytes > 0 ? subtree.physicalBytes : totalValue;

  const arcs: SunburstArc[] = [];
  const queue: HierarchyRectangularNode<SubtreeNodeDto>[] = [...rootChildren];

  let head = 0;
  while (head < queue.length) {
    const node = queue[head];
    head += 1;
    if (!node) continue;

    const val = node.value ?? 0;
    if (!Number.isFinite(val) || val <= 0) {
      continue;
    }

    const startAngle = Math.max(0, Math.min(TWO_PI, node.x0));
    const endAngle = Math.max(0, Math.min(TWO_PI, node.x1));
    const angleSpan = endAngle - startAngle;
    if (!Number.isFinite(angleSpan) || angleSpan < minAngleRad) {
      // Sub-pixel arc: descendants will have <= angleSpan, so skip whole branch
      continue;
    }

    const norm0 = Math.max(0, Math.min(1, (node.y0 - rootY1) / normalizedRadialSpan));
    const norm1 = Math.max(0, Math.min(1, (node.y1 - rootY1) / normalizedRadialSpan));
    const innerRadius = innerHoleRadius + norm0 * usableRadialPixels;
    const outerRadius = innerHoleRadius + norm1 * usableRadialPixels;

    if (
      !Number.isFinite(innerRadius) ||
      !Number.isFinite(outerRadius) ||
      outerRadius - innerRadius < 1
    ) {
      continue;
    }

    const data = node.data;
    const physicalBytes =
      Number.isFinite(data.physicalBytes) && data.physicalBytes > 0
        ? data.physicalBytes
        : val;

    arcs.push({
      id: data.id,
      name: data.name,
      path: data.path,
      isDir: data.isDir,
      isHardlinkDup: data.isHardlinkDup,
      isSyntheticOther: isSyntheticOtherId(data.id),
      physicalBytes,
      logicalBytes: Number.isFinite(data.logicalBytes)
        ? data.logicalBytes
        : physicalBytes,
      fileCount: data.fileCount,
      category: data.category,
      depth: node.depth,
      startAngle,
      endAngle,
      innerRadius,
      outerRadius,
      percentOfRoot:
        rootPhysicalBytes > 0 ? (physicalBytes / rootPhysicalBytes) * 100 : 0,
    });

    const nodeChildren = node.children;
    if (nodeChildren && nodeChildren.length > 0) {
      for (let i = 0; i < nodeChildren.length; i += 1) {
        const child = nodeChildren[i];
        if (child && child.x1 - child.x0 >= minAngleRad) {
          queue.push(child);
        }
      }
    }
  }

  return {
    arcs,
    cx,
    cy,
    maxRadius,
    innerHoleRadius,
    centerInfo: baseCenterInfo,
  };
}

/**
 * Exact polar hit-test for Sunburst sectors and center back-navigation hub.
 */
export function hitTestSunburst(
  arcs: readonly SunburstArc[],
  x: number,
  y: number,
  cx: number,
  cy: number,
  innerHoleRadius: number,
): SunburstHitResult {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(cx) ||
    !Number.isFinite(cy)
  ) {
    return null;
  }

  const dx = x - cx;
  const dy = y - cy;
  const r = Math.hypot(dx, dy);

  if (r < innerHoleRadius) {
    return { kind: "center" };
  }

  // Normalize angle to [0, 2π) starting at 12 o'clock clockwise
  const theta = (Math.atan2(dy, dx) + HALF_PI + TWO_PI) % TWO_PI;

  for (let i = 0; i < arcs.length; i += 1) {
    const arc = arcs[i];
    if (!arc) continue;
    if (
      r >= arc.innerRadius &&
      r <= arc.outerRadius &&
      theta >= arc.startAngle &&
      theta <= arc.endAngle
    ) {
      return { kind: "arc", arc };
    }
  }

  return null;
}

const FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif';

function traceArcPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
): void {
  const a0 = startAngle - HALF_PI;
  const a1 = endAngle - HALF_PI;
  ctx.beginPath();
  ctx.arc(cx, cy, outerRadius, a0, a1, false);
  ctx.arc(cx, cy, innerRadius, a1, a0, true);
  ctx.closePath();
}

function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (maxWidth <= 8) return "";
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }
  const ellipsis = "…";
  const ellipsisWidth = ctx.measureText(ellipsis).width;
  if (ellipsisWidth >= maxWidth) return "";

  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid)).width + ellipsisWidth <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return `${text.slice(0, lo)}${ellipsis}`;
}

/**
 * Render the Zoomable Sunburst onto an HTML5 Canvas 2D context.
 * `animProgress` ranges from `0` to `1` (ease-out cubic progression on drill-down).
 */
export function renderSunburstCanvas(
  ctx: CanvasRenderingContext2D,
  arcs: readonly SunburstArc[],
  centerInfo: SunburstCenterInfo,
  width: number,
  height: number,
  state: SunburstRenderState,
  animProgress = 1,
): void {
  const surface = getVizSurfacePalette(state.theme);

  ctx.fillStyle = surface.canvasBg;
  ctx.fillRect(0, 0, width, height);

  const { cx, cy, innerHoleRadius } = centerInfo;
  if (centerInfo.maxRadius <= 2) {
    return;
  }

  const t = Math.max(0, Math.min(1, animProgress));
  const radialScale = 0.85 + 0.15 * t;

  let hoveredArc: SunburstArc | null = null;
  let selectedArc: SunburstArc | null = null;

  ctx.save();
  if (t < 1) {
    ctx.globalAlpha = 0.25 + 0.75 * t;
  }

  ctx.lineWidth = 1;
  ctx.strokeStyle = surface.arcBorder;

  for (let i = 0; i < arcs.length; i += 1) {
    const arc = arcs[i];
    if (!arc) continue;

    if (state.hoveredId !== null && arc.id === state.hoveredId) {
      hoveredArc = arc;
    }
    if (state.selectedId !== null && arc.id === state.selectedId) {
      selectedArc = arc;
    }

    const rInner =
      innerHoleRadius + (arc.innerRadius - innerHoleRadius) * radialScale;
    const rOuter =
      innerHoleRadius + (arc.outerRadius - innerHoleRadius) * radialScale;

    if (rOuter - rInner < 0.75) continue;

    traceArcPath(ctx, cx, cy, rInner, rOuter, arc.startAngle, arc.endAngle);
    ctx.fillStyle = getCategoryFill(
      arc.category,
      arc.depth,
      state.theme,
      arc.isSyntheticOther,
    );
    ctx.fill();
    ctx.stroke();

    // Draw subtle inline labels on generously sized inner-ring sectors
    const angleSpan = arc.endAngle - arc.startAngle;
    const ringThickness = rOuter - rInner;
    const midR = (rInner + rOuter) / 2;
    const arcLength = angleSpan * midR;
    if (t > 0.85 && arc.depth <= 2 && arcLength >= 56 && ringThickness >= 22) {
      drawSectorLabel(ctx, arc, cx, cy, midR, arcLength, surface);
    }
  }

  // Hover highlight drawn on top of all sectors
  if (hoveredArc) {
    const rInner =
      innerHoleRadius + (hoveredArc.innerRadius - innerHoleRadius) * radialScale;
    const rOuter =
      innerHoleRadius + (hoveredArc.outerRadius - innerHoleRadius) * radialScale;
    traceArcPath(
      ctx,
      cx,
      cy,
      rInner,
      rOuter,
      hoveredArc.startAngle,
      hoveredArc.endAngle,
    );
    ctx.fillStyle = surface.hoverOverlay;
    ctx.fill();
    ctx.lineWidth = 1.75;
    ctx.strokeStyle = surface.hoverStroke;
    ctx.stroke();
  }

  // Selected sector ring drawn on top
  if (selectedArc) {
    const rInner =
      innerHoleRadius + (selectedArc.innerRadius - innerHoleRadius) * radialScale;
    const rOuter =
      innerHoleRadius + (selectedArc.outerRadius - innerHoleRadius) * radialScale;
    traceArcPath(
      ctx,
      cx,
      cy,
      rInner,
      rOuter,
      selectedArc.startAngle,
      selectedArc.endAngle,
    );
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = surface.selectedStroke;
    ctx.stroke();
  }

  ctx.restore();

  // Draw center hub with root name + physical size + back hint
  drawCenterHub(ctx, centerInfo, state, surface);
}

function drawSectorLabel(
  ctx: CanvasRenderingContext2D,
  arc: SunburstArc,
  cx: number,
  cy: number,
  midR: number,
  arcLength: number,
  surface: ReturnType<typeof getVizSurfacePalette>,
): void {
  const midAngle = (arc.startAngle + arc.endAngle) / 2 - HALF_PI;
  const lx = cx + Math.cos(midAngle) * midR;
  const ly = cy + Math.sin(midAngle) * midR;

  ctx.save();
  ctx.translate(lx, ly);

  // Align text tangent to arc and keep upright (never upside down)
  let rotation = midAngle + HALF_PI;
  const normalized = ((rotation % TWO_PI) + TWO_PI) % TWO_PI;
  if (normalized > HALF_PI && normalized < Math.PI * 1.5) {
    rotation += Math.PI;
  }
  ctx.rotate(rotation);

  ctx.font = `600 10.5px ${FONT_FAMILY}`;
  ctx.fillStyle = surface.labelText;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const maxTextWidth = Math.min(arcLength * 0.78, 120);
  const label = truncateText(ctx, arc.name, maxTextWidth);
  if (label) {
    ctx.fillText(label, 0, 0);
  }
  ctx.restore();
}

function drawCenterHub(
  ctx: CanvasRenderingContext2D,
  centerInfo: SunburstCenterInfo,
  state: SunburstRenderState,
  surface: ReturnType<typeof getVizSurfacePalette>,
): void {
  const { cx, cy, innerHoleRadius, canNavigateUp } = centerInfo;
  if (innerHoleRadius < 12) return;

  const hubRadius = Math.max(0, innerHoleRadius - 1.5);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, hubRadius, 0, TWO_PI);
  ctx.fillStyle =
    state.isCenterHovered && canNavigateUp
      ? surface.hubHoverFill
      : surface.hubFill;
  ctx.fill();

  ctx.lineWidth = state.isCenterHovered && canNavigateUp ? 1.75 : 1;
  ctx.strokeStyle =
    state.isCenterHovered && canNavigateUp
      ? surface.selectedStroke
      : surface.hubStroke;
  ctx.stroke();

  // Clip text inside hub circle
  ctx.clip();

  const maxTextWidth = hubRadius * 1.65;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Root name
  const titleFontSize = hubRadius >= 58 ? 13 : 11.5;
  ctx.font = `600 ${titleFontSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = surface.hubTitle;
  const nameText = truncateText(ctx, centerInfo.name, maxTextWidth);
  const nameY = canNavigateUp && hubRadius >= 46 ? cy - 11 : cy - 7;
  ctx.fillText(nameText, cx, nameY);

  // Physical size
  const sizeFontSize = hubRadius >= 58 ? 12 : 10.5;
  ctx.font = `500 ${sizeFontSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = surface.hubSubtitle;
  const sizeText = formatVizBytes(centerInfo.physicalBytes);
  const sizeY = canNavigateUp && hubRadius >= 46 ? cy + 6 : cy + 9;
  ctx.fillText(sizeText, cx, sizeY);

  // Up navigation hint when parent breadcrumb exists
  if (canNavigateUp && hubRadius >= 46) {
    ctx.font = `500 10px ${FONT_FAMILY}`;
    ctx.fillStyle = surface.hubHint;
    ctx.fillText("↑ Back", cx, cy + 22);
  }

  ctx.restore();
}
