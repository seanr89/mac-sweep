import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import type { NodeKey, SubtreeNodeDto } from "../../lib/ipc/types";
import {
  formatVizBytes,
  getSystemTheme,
  prefersReducedMotion,
  subscribeSystemTheme,
  type VizTheme,
} from "../../lib/viz/palette";
import {
  computeSunburstLayout,
  hitTestSunburst,
  renderSunburstCanvas,
  type SunburstArc,
} from "../../lib/viz/sunburstLayout";
import {
  VizContextMenu,
  type VizContextAction,
  type VizContextMenuTarget,
} from "./VizContextMenu";
import { VizTooltip, type VizTooltipData } from "./VizTooltip";

export interface SunburstCanvasProps {
  subtree: SubtreeNodeDto;
  canNavigateParent: boolean;
  onNavigateParent: () => void;
  selectedNodeId: NodeKey | null;
  hoveredNodeId: NodeKey | null;
  onHoverNode: (nodeId: NodeKey | null) => void;
  onSelectNode: (nodeId: NodeKey | null) => void;
  onDrillDown: (nodeId: NodeKey) => void;
  onContextAction?: (action: VizContextAction, nodeId: NodeKey) => void;
}

interface ViewportSize {
  width: number;
  height: number;
  dpr: number;
}

interface LocalArcHover {
  arc: SunburstArc;
  x: number;
  y: number;
}

const TRANSITION_DURATION_MS = 220;

function easeOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - (1 - clamped) * (1 - clamped) * (1 - clamped);
}

export function SunburstCanvas({
  subtree,
  canNavigateParent,
  onNavigateParent,
  selectedNodeId,
  hoveredNodeId,
  onHoverNode,
  onSelectNode,
  onDrillDown,
  onContextAction,
}: SunburstCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [viewport, setViewport] = useState<ViewportSize>({
    width: 0,
    height: 0,
    dpr: 1,
  });
  const [theme, setTheme] = useState<VizTheme>(() => getSystemTheme());
  const [localHover, setLocalHover] = useState<LocalArcHover | null>(null);
  const [isCenterHovered, setIsCenterHovered] = useState(false);
  const [contextMenu, setContextMenu] = useState<VizContextMenuTarget | null>(
    null,
  );

  useEffect(() => {
    setTheme(getSystemTheme());
    return subscribeSystemTheme(setTheme);
  }, []);

  // Observe container size for HiDPI backing store
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = (width: number, height: number) => {
      const nextWidth = Math.max(0, Math.floor(width));
      const nextHeight = Math.max(0, Math.floor(height));
      const nextDpr = Math.min(window.devicePixelRatio || 1, 3);
      setViewport((prev) =>
        prev.width === nextWidth &&
        prev.height === nextHeight &&
        prev.dpr === nextDpr
          ? prev
          : { width: nextWidth, height: nextHeight, dpr: nextDpr },
      );
    };

    const rect = container.getBoundingClientRect();
    updateSize(rect.width, rect.height);

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      updateSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(
    () => computeSunburstLayout(subtree, viewport.width, viewport.height),
    [subtree, viewport.width, viewport.height],
  );

  const centerInfo = useMemo(
    () => ({
      ...layout.centerInfo,
      canNavigateUp: canNavigateParent,
    }),
    [layout.centerInfo, canNavigateParent],
  );

  const activeHoverId = localHover?.arc.id ?? hoveredNodeId;

  // Refs for dirty-flag rendering and bounded 220ms transition animation
  const drawRafRef = useRef<number | null>(null);
  const animRafRef = useRef<number | null>(null);
  const animProgressRef = useRef(1);
  const prevSubtreeIdRef = useRef<NodeKey | null>(null);

  const latestRenderRef = useRef({
    layout,
    centerInfo,
    viewport,
    theme,
    hoveredId: activeHoverId,
    selectedId: selectedNodeId,
    isCenterHovered,
  });

  latestRenderRef.current = {
    layout,
    centerInfo,
    viewport,
    theme,
    hoveredId: activeHoverId,
    selectedId: selectedNodeId,
    isCenterHovered,
  };

  const paintNow = useCallback((progress: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const {
      layout: currentLayout,
      centerInfo: currentCenter,
      viewport: currentViewport,
      theme: currentTheme,
      hoveredId: currentHoveredId,
      selectedId: currentSelectedId,
      isCenterHovered: currentCenterHovered,
    } = latestRenderRef.current;

    if (currentViewport.width <= 0 || currentViewport.height <= 0) {
      return;
    }

    const backingWidth = Math.floor(
      currentViewport.width * currentViewport.dpr,
    );
    const backingHeight = Math.floor(
      currentViewport.height * currentViewport.dpr,
    );

    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(currentViewport.dpr, 0, 0, currentViewport.dpr, 0, 0);
    renderSunburstCanvas(
      ctx,
      currentLayout.arcs,
      currentCenter,
      currentViewport.width,
      currentViewport.height,
      {
        theme: currentTheme,
        hoveredId: currentHoveredId,
        selectedId: currentSelectedId,
        isCenterHovered: currentCenterHovered,
      },
      progress,
    );
  }, []);

  const scheduleDraw = useCallback(() => {
    // If the 220ms zoom animation is active, it already paints every frame
    if (animRafRef.current !== null || drawRafRef.current !== null) {
      return;
    }
    drawRafRef.current = window.requestAnimationFrame(() => {
      drawRafRef.current = null;
      paintNow(animProgressRef.current);
    });
  }, [paintNow]);

  // Trigger bounded ~220ms ease-out cubic animation when subtree.id changes
  useEffect(() => {
    setContextMenu(null);
    setLocalHover(null);
    setIsCenterHovered(false);

    const isFirstMount = prevSubtreeIdRef.current === null;
    const idChanged = prevSubtreeIdRef.current !== subtree.id;
    prevSubtreeIdRef.current = subtree.id;

    if (animRafRef.current !== null) {
      window.cancelAnimationFrame(animRafRef.current);
      animRafRef.current = null;
    }

    if (isFirstMount || !idChanged || prefersReducedMotion()) {
      animProgressRef.current = 1;
      scheduleDraw();
      return;
    }

    const startTime = performance.now();
    animProgressRef.current = 0;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const rawT = Math.min(1, elapsed / TRANSITION_DURATION_MS);
      const eased = easeOutCubic(rawT);
      animProgressRef.current = eased;
      paintNow(eased);

      if (rawT < 1) {
        animRafRef.current = window.requestAnimationFrame(tick);
      } else {
        // Animation settled: stop rAF loop immediately (0% idle CPU)
        animRafRef.current = null;
        animProgressRef.current = 1;
      }
    };

    animRafRef.current = window.requestAnimationFrame(tick);
  }, [subtree.id, paintNow, scheduleDraw]);

  // Dirty-flag repaint on state/layout/theme changes
  useEffect(() => {
    scheduleDraw();
  }, [
    layout,
    centerInfo,
    viewport,
    theme,
    activeHoverId,
    selectedNodeId,
    isCenterHovered,
    scheduleDraw,
  ]);

  const hoverRafRef = useRef<number | null>(null);
  const pendingPointerRef = useRef<{ x: number; y: number } | null>(null);
  const lastEmittedHoverIdRef = useRef<NodeKey | null>(null);

  useEffect(() => {
    return () => {
      if (drawRafRef.current !== null) {
        window.cancelAnimationFrame(drawRafRef.current);
        drawRafRef.current = null;
      }
      if (animRafRef.current !== null) {
        window.cancelAnimationFrame(animRafRef.current);
        animRafRef.current = null;
      }
      if (hoverRafRef.current !== null) {
        window.cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = null;
      }
    };
  }, []);

  const getLocalCoords = useCallback((event: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
  }, []);

  const handleMouseMove = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      const coords = getLocalCoords(event);
      if (!coords) return;

      pendingPointerRef.current = coords;
      if (hoverRafRef.current !== null) {
        return;
      }

      hoverRafRef.current = window.requestAnimationFrame(() => {
        hoverRafRef.current = null;
        const point = pendingPointerRef.current;
        if (!point) return;

        const current = latestRenderRef.current.layout;
        const hit = hitTestSunburst(
          current.arcs,
          point.x,
          point.y,
          current.cx,
          current.cy,
          current.innerHoleRadius,
        );

        if (hit?.kind === "center") {
          setIsCenterHovered(true);
          setLocalHover(null);
          if (lastEmittedHoverIdRef.current !== null) {
            lastEmittedHoverIdRef.current = null;
            onHoverNode(null);
          }
        } else if (hit?.kind === "arc") {
          setIsCenterHovered(false);
          setLocalHover({ arc: hit.arc, x: point.x, y: point.y });
          const nextEmittedId = hit.arc.isSyntheticOther ? null : hit.arc.id;
          if (lastEmittedHoverIdRef.current !== nextEmittedId) {
            lastEmittedHoverIdRef.current = nextEmittedId;
            onHoverNode(nextEmittedId);
          }
        } else {
          setIsCenterHovered(false);
          setLocalHover(null);
          if (lastEmittedHoverIdRef.current !== null) {
            lastEmittedHoverIdRef.current = null;
            onHoverNode(null);
          }
        }
      });
    },
    [getLocalCoords, onHoverNode],
  );

  const handleMouseLeave = useCallback(() => {
    pendingPointerRef.current = null;
    if (hoverRafRef.current !== null) {
      window.cancelAnimationFrame(hoverRafRef.current);
      hoverRafRef.current = null;
    }
    setIsCenterHovered(false);
    setLocalHover(null);
    if (lastEmittedHoverIdRef.current !== null) {
      lastEmittedHoverIdRef.current = null;
      onHoverNode(null);
    }
  }, [onHoverNode]);

  const handleClick = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      setContextMenu(null);
      const coords = getLocalCoords(event);
      if (!coords) return;

      const hit = hitTestSunburst(
        layout.arcs,
        coords.x,
        coords.y,
        layout.cx,
        layout.cy,
        layout.innerHoleRadius,
      );

      if (hit?.kind === "center") {
        if (canNavigateParent) {
          onNavigateParent();
        }
        return;
      }

      if (hit?.kind === "arc" && !hit.arc.isSyntheticOther) {
        onSelectNode(hit.arc.id);
      } else {
        onSelectNode(null);
      }
    },
    [
      getLocalCoords,
      layout,
      canNavigateParent,
      onNavigateParent,
      onSelectNode,
    ],
  );

  const handleDoubleClick = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      setContextMenu(null);
      const coords = getLocalCoords(event);
      if (!coords) return;

      const hit = hitTestSunburst(
        layout.arcs,
        coords.x,
        coords.y,
        layout.cx,
        layout.cy,
        layout.innerHoleRadius,
      );

      if (hit?.kind === "arc" && hit.arc.isDir && !hit.arc.isSyntheticOther) {
        onDrillDown(hit.arc.id);
      }
    },
    [getLocalCoords, layout, onDrillDown],
  );

  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      const coords = getLocalCoords(event);
      if (!coords) return;

      const hit = hitTestSunburst(
        layout.arcs,
        coords.x,
        coords.y,
        layout.cx,
        layout.cy,
        layout.innerHoleRadius,
      );

      if (hit?.kind !== "arc" || hit.arc.isSyntheticOther) {
        setContextMenu(null);
        return;
      }

      onSelectNode(hit.arc.id);
      setContextMenu({
        id: hit.arc.id,
        name: hit.arc.name,
        isDir: hit.arc.isDir,
        physicalBytes: hit.arc.physicalBytes,
        x: coords.x,
        y: coords.y,
      });
    },
    [getLocalCoords, layout, onSelectNode],
  );

  const handleContextMenuAction = useCallback(
    (action: VizContextAction, nodeId: NodeKey) => {
      if (onContextAction) {
        onContextAction(action, nodeId);
      } else if (action === "zoom") {
        onDrillDown(nodeId);
      }
    },
    [onContextAction, onDrillDown],
  );

  const tooltipData: VizTooltipData | null = localHover
    ? {
        id: localHover.arc.id,
        name: localHover.arc.name,
        path: localHover.arc.path,
        isDir: localHover.arc.isDir,
        isHardlinkDup: localHover.arc.isHardlinkDup,
        isSyntheticOther: localHover.arc.isSyntheticOther,
        physicalBytes: localHover.arc.physicalBytes,
        logicalBytes: localHover.arc.logicalBytes,
        fileCount: localHover.arc.fileCount,
        category: localHover.arc.category,
        percentOfRoot: localHover.arc.percentOfRoot,
      }
    : null;

  const isPointer =
    (isCenterHovered && canNavigateParent) ||
    Boolean(localHover?.arc.isDir && !localHover.arc.isSyntheticOther);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden select-none"
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Sunburst chart of ${subtree.name} (${formatVizBytes(subtree.physicalBytes)})`}
        style={{
          width: viewport.width > 0 ? `${viewport.width}px` : "100%",
          height: viewport.height > 0 ? `${viewport.height}px` : "100%",
        }}
        className={`block ${isPointer ? "cursor-pointer" : "cursor-default"}`}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      />

      {tooltipData && localHover && !contextMenu && (
        <VizTooltip
          data={tooltipData}
          x={localHover.x}
          y={localHover.y}
          containerWidth={viewport.width}
          containerHeight={viewport.height}
          theme={theme}
        />
      )}

      {contextMenu && (
        <VizContextMenu
          target={contextMenu}
          containerWidth={viewport.width}
          containerHeight={viewport.height}
          onAction={handleContextMenuAction}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
