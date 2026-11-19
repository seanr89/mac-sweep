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
  subscribeSystemTheme,
  type VizTheme,
} from "../../lib/viz/palette";
import {
  computeTreemapLayout,
  hitTestTreemap,
  renderTreemapCanvas,
  type TreemapRect,
} from "../../lib/viz/treemapLayout";
import {
  VizContextMenu,
  type VizContextAction,
  type VizContextMenuTarget,
} from "./VizContextMenu";
import { VizTooltip, type VizTooltipData } from "./VizTooltip";

export interface TreemapCanvasProps {
  subtree: SubtreeNodeDto;
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

interface LocalHover {
  rect: TreemapRect;
  x: number;
  y: number;
}

export function TreemapCanvas({
  subtree,
  selectedNodeId,
  hoveredNodeId,
  onHoverNode,
  onSelectNode,
  onDrillDown,
  onContextAction,
}: TreemapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [viewport, setViewport] = useState<ViewportSize>({
    width: 0,
    height: 0,
    dpr: 1,
  });
  const [theme, setTheme] = useState<VizTheme>(() => getSystemTheme());
  const [localHover, setLocalHover] = useState<LocalHover | null>(null);
  const [contextMenu, setContextMenu] = useState<VizContextMenuTarget | null>(
    null,
  );

  // Subscribe to macOS Light/Dark appearance changes
  useEffect(() => {
    setTheme(getSystemTheme());
    return subscribeSystemTheme(setTheme);
  }, []);

  // Close context menu and clear stale hover when focused root changes
  useEffect(() => {
    setContextMenu(null);
    setLocalHover(null);
  }, [subtree.id]);

  // Observe container dimensions for razor-sharp HiDPI canvas sizing
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

  // Recompute squarified treemap layout only when subtree or viewport changes
  const rects = useMemo(
    () => computeTreemapLayout(subtree, viewport.width, viewport.height),
    [subtree, viewport.width, viewport.height],
  );

  // Synced hover id: prefer local hovered cell (supports synthetic Other), else external sidebar hover
  const activeHoverId = localHover?.rect.id ?? hoveredNodeId;

  // Dirty-flag single-frame renderer (zero idle rAF loops)
  const drawRafRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const latestRenderRef = useRef({
    rects,
    viewport,
    theme,
    hoveredId: activeHoverId,
    selectedId: selectedNodeId,
  });

  latestRenderRef.current = {
    rects,
    viewport,
    theme,
    hoveredId: activeHoverId,
    selectedId: selectedNodeId,
  };

  const scheduleDraw = useCallback(() => {
    dirtyRef.current = true;
    if (drawRafRef.current !== null) {
      return;
    }
    drawRafRef.current = window.requestAnimationFrame(() => {
      drawRafRef.current = null;
      if (!dirtyRef.current) return;
      dirtyRef.current = false;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const {
        rects: currentRects,
        viewport: currentViewport,
        theme: currentTheme,
        hoveredId: currentHoveredId,
        selectedId: currentSelectedId,
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
      renderTreemapCanvas(
        ctx,
        currentRects,
        currentViewport.width,
        currentViewport.height,
        {
          theme: currentTheme,
          hoveredId: currentHoveredId,
          selectedId: currentSelectedId,
        },
      );
    });
  }, []);

  useEffect(() => {
    scheduleDraw();
  }, [rects, viewport, theme, activeHoverId, selectedNodeId, scheduleDraw]);

  // Cancel any pending draw or hover rAF on unmount
  const hoverRafRef = useRef<number | null>(null);
  const pendingPointerRef = useRef<{ x: number; y: number } | null>(null);
  const lastEmittedHoverIdRef = useRef<NodeKey | null>(null);

  useEffect(() => {
    return () => {
      if (drawRafRef.current !== null) {
        window.cancelAnimationFrame(drawRafRef.current);
        drawRafRef.current = null;
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

        const hit = hitTestTreemap(latestRenderRef.current.rects, point.x, point.y);
        if (hit) {
          setLocalHover({ rect: hit, x: point.x, y: point.y });
          const nextEmittedId = hit.isSyntheticOther ? null : hit.id;
          if (lastEmittedHoverIdRef.current !== nextEmittedId) {
            lastEmittedHoverIdRef.current = nextEmittedId;
            onHoverNode(nextEmittedId);
          }
        } else {
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
      const hit = hitTestTreemap(rects, coords.x, coords.y);
      if (hit && !hit.isSyntheticOther) {
        onSelectNode(hit.id);
      } else {
        onSelectNode(null);
      }
    },
    [getLocalCoords, rects, onSelectNode],
  );

  const handleDoubleClick = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      setContextMenu(null);
      const coords = getLocalCoords(event);
      if (!coords) return;
      const hit = hitTestTreemap(rects, coords.x, coords.y);
      if (hit && hit.isDir && !hit.isSyntheticOther) {
        onDrillDown(hit.id);
      }
    },
    [getLocalCoords, rects, onDrillDown],
  );

  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      const coords = getLocalCoords(event);
      if (!coords) return;

      const hit = hitTestTreemap(rects, coords.x, coords.y);
      if (!hit || hit.isSyntheticOther) {
        setContextMenu(null);
        return;
      }

      onSelectNode(hit.id);
      setContextMenu({
        id: hit.id,
        name: hit.name,
        isDir: hit.isDir,
        physicalBytes: hit.physicalBytes,
        x: coords.x,
        y: coords.y,
      });
    },
    [getLocalCoords, rects, onSelectNode],
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
        id: localHover.rect.id,
        name: localHover.rect.name,
        path: localHover.rect.path,
        isDir: localHover.rect.isDir,
        isHardlinkDup: localHover.rect.isHardlinkDup,
        isSyntheticOther: localHover.rect.isSyntheticOther,
        physicalBytes: localHover.rect.physicalBytes,
        logicalBytes: localHover.rect.logicalBytes,
        fileCount: localHover.rect.fileCount,
        category: localHover.rect.category,
        percentOfRoot: localHover.rect.percentOfRoot,
      }
    : null;

  const cursorClass =
    localHover?.rect.isDir && !localHover.rect.isSyntheticOther
      ? "cursor-pointer"
      : localHover
        ? "cursor-default"
        : "cursor-default";

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden select-none"
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Treemap of ${subtree.name} (${formatVizBytes(subtree.physicalBytes)})`}
        style={{
          width: viewport.width > 0 ? `${viewport.width}px` : "100%",
          height: viewport.height > 0 ? `${viewport.height}px` : "100%",
        }}
        className={`block ${cursorClass}`}
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
