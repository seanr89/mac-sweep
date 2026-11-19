import type { FileCategory, NodeKey } from "../../lib/ipc/types";
import {
  CATEGORY_PALETTE,
  formatVizBytes,
  getCategorySwatch,
  type VizTheme,
} from "../../lib/viz/palette";

export interface VizTooltipData {
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
  percentOfRoot: number;
}

export interface VizTooltipProps {
  data: VizTooltipData;
  x: number;
  y: number;
  containerWidth: number;
  containerHeight: number;
  theme: VizTheme;
}

const TOOLTIP_EST_WIDTH = 264;
const TOOLTIP_EST_HEIGHT = 152;
const EDGE_MARGIN = 10;
const CURSOR_OFFSET = 14;

export function VizTooltip({
  data,
  x,
  y,
  containerWidth,
  containerHeight,
  theme,
}: VizTooltipProps) {
  const isSparse =
    !data.isHardlinkDup &&
    data.physicalBytes > 0 &&
    data.logicalBytes > data.physicalBytes * 1.25;
  const showLogical =
    data.logicalBytes !== data.physicalBytes && data.logicalBytes > 0;

  let left = x + CURSOR_OFFSET;
  if (left + TOOLTIP_EST_WIDTH > containerWidth - EDGE_MARGIN) {
    left = Math.max(EDGE_MARGIN, x - TOOLTIP_EST_WIDTH - CURSOR_OFFSET);
  }

  let top = y + CURSOR_OFFSET;
  if (top + TOOLTIP_EST_HEIGHT > containerHeight - EDGE_MARGIN) {
    top = Math.max(EDGE_MARGIN, y - TOOLTIP_EST_HEIGHT - CURSOR_OFFSET);
  }

  const pctText =
    data.percentOfRoot < 0.1 && data.percentOfRoot > 0
      ? "<0.1%"
      : data.percentOfRoot >= 99.95
        ? "100%"
        : `${data.percentOfRoot >= 10 ? data.percentOfRoot.toFixed(1) : data.percentOfRoot.toFixed(2)}%`;

  const swatchColor = getCategorySwatch(data.category, theme);
  const categoryLabel =
    CATEGORY_PALETTE[data.category]?.label ?? CATEGORY_PALETTE.other.label;

  return (
    <div
      role="status"
      aria-live="off"
      style={{
        transform: `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`,
      }}
      className="pointer-events-none absolute top-0 left-0 z-30 w-64 rounded-xl border border-neutral-200/90 bg-white/92 p-3 text-xs text-neutral-900 shadow-lg ring-1 ring-black/5 backdrop-blur-md dark:border-neutral-700/80 dark:bg-neutral-900/92 dark:text-neutral-100 dark:ring-white/10"
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/20"
          style={{ backgroundColor: swatchColor }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-semibold text-neutral-900 dark:text-neutral-50">
              {data.name}
            </span>
            {isSparse && (
              <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-400/20 dark:text-amber-300">
                Sparse
              </span>
            )}
            {data.isHardlinkDup && (
              <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-400/20 dark:text-sky-300">
                Hard-link
              </span>
            )}
            {data.isSyntheticOther && (
              <span className="shrink-0 rounded bg-neutral-500/15 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 dark:bg-neutral-400/20 dark:text-neutral-300">
                Grouped
              </span>
            )}
          </div>
          <div className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
            {categoryLabel}
          </div>
        </div>
      </div>

      <dl className="mt-2.5 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t border-neutral-200/75 pt-2 dark:border-neutral-800/80">
        <dt className="text-neutral-500 dark:text-neutral-400">
          Physical Size
        </dt>
        <dd className="text-right font-semibold tabular-nums text-neutral-950 dark:text-white">
          {formatVizBytes(data.physicalBytes)}
        </dd>

        {showLogical && (
          <>
            <dt
              className={
                isSparse
                  ? "font-medium text-amber-700 dark:text-amber-300"
                  : "text-neutral-500 dark:text-neutral-400"
              }
            >
              Logical Size
            </dt>
            <dd
              className={`text-right tabular-nums ${
                isSparse
                  ? "font-semibold text-amber-700 dark:text-amber-300"
                  : "text-neutral-700 dark:text-neutral-300"
              }`}
            >
              {formatVizBytes(data.logicalBytes)}
            </dd>
          </>
        )}

        {!data.isSyntheticOther && (
          <>
            <dt className="text-neutral-500 dark:text-neutral-400">Files</dt>
            <dd className="text-right tabular-nums text-neutral-700 dark:text-neutral-300">
              {data.fileCount.toLocaleString()}
            </dd>
          </>
        )}

        <dt className="text-neutral-500 dark:text-neutral-400">Share</dt>
        <dd className="text-right font-medium tabular-nums text-neutral-800 dark:text-neutral-200">
          {pctText}
        </dd>
      </dl>

      {data.isDir && !data.isSyntheticOther && (
        <div className="mt-2 border-t border-neutral-200/60 pt-1.5 text-[10px] text-neutral-500 dark:border-neutral-800/70 dark:text-neutral-400">
          Double-click to zoom in · Right-click for actions
        </div>
      )}
    </div>
  );
}
