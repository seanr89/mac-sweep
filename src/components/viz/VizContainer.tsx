import {
  ChevronRight,
  CircleDot,
  FolderSearch,
  LayoutGrid,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  BreadcrumbDto,
  NodeKey,
  SubtreeNodeDto,
  VizMode,
} from "../../lib/ipc/types";
import {
  formatVizBytes,
  getCategorySwatch,
  getSystemTheme,
  ORDERED_FILE_CATEGORIES,
  subscribeSystemTheme,
  type VizTheme,
} from "../../lib/viz/palette";
import { SunburstCanvas } from "./SunburstCanvas";
import { TreemapCanvas } from "./TreemapCanvas";

export interface VizContainerProps {
  subtree: SubtreeNodeDto | null;
  vizMode: VizMode;
  onVizModeChange: (mode: VizMode) => void;
  breadcrumbs: BreadcrumbDto[];
  selectedNodeId: NodeKey | null;
  hoveredNodeId: NodeKey | null;
  onHoverNode: (nodeId: NodeKey | null) => void;
  onSelectNode: (nodeId: NodeKey | null) => void;
  onDrillDown: (nodeId: NodeKey) => void;
  onNavigateBreadcrumb: (nodeId: NodeKey) => void;
  onContextAction?: (
    action: "zoom" | "reveal" | "trash",
    nodeId: NodeKey,
  ) => void;
}

export function VizContainer({
  subtree,
  vizMode,
  onVizModeChange,
  breadcrumbs,
  selectedNodeId,
  hoveredNodeId,
  onHoverNode,
  onSelectNode,
  onDrillDown,
  onNavigateBreadcrumb,
  onContextAction,
}: VizContainerProps) {
  const [theme, setTheme] = useState<VizTheme>(() => getSystemTheme());

  useEffect(() => {
    setTheme(getSystemTheme());
    return subscribeSystemTheme(setTheme);
  }, []);

  const parentBreadcrumb =
    breadcrumbs.length >= 2
      ? (breadcrumbs[breadcrumbs.length - 2] ?? null)
      : null;

  const handleNavigateParent = () => {
    if (parentBreadcrumb) {
      onNavigateBreadcrumb(parentBreadcrumb.id);
    }
  };

  return (
    <section
      aria-label="Disk usage visualization"
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-neutral-200/80 bg-white/80 shadow-xs backdrop-blur-sm dark:border-neutral-800/80 dark:bg-neutral-900/70"
    >
      {/* Header: Breadcrumbs + Segmented Mode Toggle + Category Legend */}
      <header className="flex shrink-0 flex-col gap-2 border-b border-neutral-200/80 bg-neutral-50/75 px-3.5 py-2.5 dark:border-neutral-800/80 dark:bg-neutral-900/80">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Interactive Breadcrumb Trail */}
          <nav
            aria-label="Folder path"
            className="min-w-0 flex-1 overflow-x-auto"
          >
            {breadcrumbs.length > 0 ? (
              <ol className="flex items-center gap-0.5 whitespace-nowrap text-xs">
                {breadcrumbs.map((crumb, index) => {
                  const isCurrent = index === breadcrumbs.length - 1;
                  return (
                    <li key={crumb.id} className="flex items-center gap-0.5">
                      {index > 0 && (
                        <ChevronRight
                          aria-hidden="true"
                          className="h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-600"
                        />
                      )}
                      <button
                        type="button"
                        aria-current={isCurrent ? "location" : undefined}
                        onClick={() => onNavigateBreadcrumb(crumb.id)}
                        className={`inline-flex min-h-6 items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500 ${
                          isCurrent
                            ? "font-semibold text-neutral-900 dark:text-neutral-50"
                            : "text-neutral-600 hover:bg-neutral-200/70 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                        }`}
                      >
                        <span className="max-w-44 truncate">{crumb.name}</span>
                        {isCurrent && (
                          <span className="rounded bg-neutral-200/75 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                            {formatVizBytes(crumb.physicalBytes)}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {subtree ? subtree.name : "No folder scanned"}
              </span>
            )}
          </nav>

          {/* Native macOS-style Segmented Toggle */}
          <div
            role="group"
            aria-label="Visualization mode"
            className="inline-flex shrink-0 items-center rounded-lg bg-neutral-200/75 p-0.5 text-xs font-medium dark:bg-neutral-800/90"
          >
            <button
              type="button"
              aria-pressed={vizMode === "treemap"}
              onClick={() => onVizModeChange("treemap")}
              className={`inline-flex min-h-6 items-center gap-1.5 rounded-md px-2.5 py-1 transition-all focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500 ${
                vizMode === "treemap"
                  ? "bg-white text-neutral-900 shadow-xs dark:bg-neutral-700 dark:text-white"
                  : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200"
              }`}
            >
              <LayoutGrid aria-hidden="true" className="h-3.5 w-3.5" />
              <span>Treemap</span>
            </button>

            <button
              type="button"
              aria-pressed={vizMode === "sunburst"}
              onClick={() => onVizModeChange("sunburst")}
              className={`inline-flex min-h-6 items-center gap-1.5 rounded-md px-2.5 py-1 transition-all focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500 ${
                vizMode === "sunburst"
                  ? "bg-white text-neutral-900 shadow-xs dark:bg-neutral-700 dark:text-white"
                  : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200"
              }`}
            >
              <CircleDot aria-hidden="true" className="h-3.5 w-3.5" />
              <span>Sunburst</span>
            </button>
          </div>
        </div>

        {/* Subtle Category Color Legend */}
        <ul
          aria-label="File category legend"
          role="list"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-600 dark:text-neutral-400"
        >
          {ORDERED_FILE_CATEGORIES.map((meta) => (
            <li key={meta.category} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full ring-1 ring-black/10 dark:ring-white/15"
                style={{
                  backgroundColor: getCategorySwatch(meta.category, theme),
                }}
              />
              <span>{meta.label}</span>
            </li>
          ))}
        </ul>
      </header>

      {/* Main Visualization Canvas Area */}
      <div className="relative min-h-0 flex-1">
        {subtree === null ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-neutral-200/80 bg-neutral-100/80 text-neutral-400 dark:border-neutral-800 dark:bg-neutral-800/70 dark:text-neutral-500">
              <FolderSearch aria-hidden="true" className="h-6 w-6" />
            </div>
            <div className="max-w-xs space-y-1">
              <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                No Disk Scan Active
              </p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Choose a folder or volume to visualize allocated APFS disk usage
                in an interactive Treemap or Sunburst view.
              </p>
            </div>
          </div>
        ) : vizMode === "treemap" ? (
          <TreemapCanvas
            subtree={subtree}
            selectedNodeId={selectedNodeId}
            hoveredNodeId={hoveredNodeId}
            onHoverNode={onHoverNode}
            onSelectNode={onSelectNode}
            onDrillDown={onDrillDown}
            onContextAction={onContextAction}
          />
        ) : (
          <SunburstCanvas
            subtree={subtree}
            canNavigateParent={parentBreadcrumb !== null}
            onNavigateParent={handleNavigateParent}
            selectedNodeId={selectedNodeId}
            hoveredNodeId={hoveredNodeId}
            onHoverNode={onHoverNode}
            onSelectNode={onSelectNode}
            onDrillDown={onDrillDown}
            onContextAction={onContextAction}
          />
        )}
      </div>
    </section>
  );
}
