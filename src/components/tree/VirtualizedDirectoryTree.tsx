import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpLeft,
  Cog,
  Disc,
  File,
  FileCode,
  FileText,
  Film,
  Folder,
  FolderOpen,
  Link2,
  Lock,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef } from "react";
import {
  formatBytes,
  formatCount,
  formatPercent,
  isSparseFile,
} from "../../lib/format";
import type {
  FileCategory,
  NodeSummaryDto,
  SortField,
} from "../../lib/ipc/types";
import { useSweepStore } from "../../store/useSweepStore";

function NodeIcon({ item }: { item: NodeSummaryDto }) {
  if (item.permissionDenied) {
    return (
      <Lock
        className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
        aria-hidden="true"
      />
    );
  }
  if (item.isSymlink) {
    return (
      <Link2
        className="h-4 w-4 shrink-0 text-sky-500 dark:text-sky-400"
        aria-hidden="true"
      />
    );
  }
  if (item.isDir) {
    return (
      <Folder
        className="h-4 w-4 shrink-0 fill-blue-500/20 text-blue-600 dark:fill-blue-400/20 dark:text-blue-400"
        aria-hidden="true"
      />
    );
  }
  return <CategoryFileIcon category={item.category} />;
}

function CategoryFileIcon({ category }: { category: FileCategory }) {
  switch (category) {
    case "code":
      return (
        <FileCode
          className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400"
          aria-hidden="true"
        />
      );
    case "media":
      return (
        <Film
          className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400"
          aria-hidden="true"
        />
      );
    case "archive":
      return (
        <Archive
          className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
          aria-hidden="true"
        />
      );
    case "diskImage":
      return (
        <Disc
          className="h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400"
          aria-hidden="true"
        />
      );
    case "document":
      return (
        <FileText
          className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
          aria-hidden="true"
        />
      );
    case "system":
      return (
        <Cog
          className="h-4 w-4 shrink-0 text-neutral-500 dark:text-neutral-400"
          aria-hidden="true"
        />
      );
    default:
      return (
        <File
          className="h-4 w-4 shrink-0 text-neutral-500 dark:text-neutral-400"
          aria-hidden="true"
        />
      );
  }
}

interface SortHeaderButtonProps {
  field: SortField;
  label: string;
  align?: "left" | "right";
  activeField: SortField;
  sortDir: "asc" | "desc";
  onSort: (field: SortField) => void;
}

function SortHeaderButton({
  field,
  label,
  align = "left",
  activeField,
  sortDir,
  onSort,
}: SortHeaderButtonProps) {
  const isActive = activeField === field;
  const Icon = sortDir === "asc" ? ArrowUp : ArrowDown;

  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      aria-label={`Sort by ${label}`}
      className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] font-medium transition-colors hover:text-neutral-900 dark:hover:text-neutral-100 ${
        align === "right" ? "ml-auto justify-end" : "justify-start"
      } ${
        isActive
          ? "text-neutral-900 dark:text-neutral-100"
          : "text-neutral-500 dark:text-neutral-400"
      }`}
    >
      <span>{label}</span>
      {isActive && <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />}
    </button>
  );
}

export function VirtualizedDirectoryTree() {
  const filterInputId = useId();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const childrenPage = useSweepStore((s) => s.childrenPage);
  const breadcrumbs = useSweepStore((s) => s.breadcrumbs);
  const sortBy = useSweepStore((s) => s.sortBy);
  const sortDir = useSweepStore((s) => s.sortDir);
  const filterQuery = useSweepStore((s) => s.filterQuery);
  const selectedNodeIds = useSweepStore((s) => s.selectedNodeIds);
  const hoveredNodeId = useSweepStore((s) => s.hoveredNodeId);
  const isLoadingMoreChildren = useSweepStore((s) => s.isLoadingMoreChildren);

  const setSort = useSweepStore((s) => s.setSort);
  const setFilterQuery = useSweepStore((s) => s.setFilterQuery);
  const toggleSelectNode = useSweepStore((s) => s.toggleSelectNode);
  const selectNodes = useSweepStore((s) => s.selectNodes);
  const clearSelection = useSweepStore((s) => s.clearSelection);
  const setHoveredNode = useSweepStore((s) => s.setHoveredNode);
  const drillDown = useSweepStore((s) => s.drillDown);
  const navigateBreadcrumb = useSweepStore((s) => s.navigateBreadcrumb);
  const loadMoreChildren = useSweepStore((s) => s.loadMoreChildren);
  const revealInFinder = useSweepStore((s) => s.revealInFinder);
  const openDeleteModal = useSweepStore((s) => s.openDeleteModal);

  const items = childrenPage?.items ?? [];
  const totalCount = childrenPage?.totalCount ?? 0;
  const hasMore = childrenPage?.hasMore ?? false;
  const parentBreadcrumb =
    breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2] : undefined;

  const allVisibleSelected = useMemo(() => {
    if (items.length === 0) return false;
    return items.every((item) => selectedNodeIds.has(item.id));
  }, [items, selectedNodeIds]);

  const someVisibleSelected = useMemo(() => {
    if (items.length === 0) return false;
    return items.some((item) => selectedNodeIds.has(item.id));
  }, [items, selectedNodeIds]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 40,
    overscan: 12,
  });

  const virtualRows = virtualizer.getVirtualItems();

  // Trigger incremental loading when user scrolls near the end of large directories
  useEffect(() => {
    const lastRow = virtualRows[virtualRows.length - 1];
    if (
      lastRow &&
      hasMore &&
      !isLoadingMoreChildren &&
      lastRow.index >= items.length - 25
    ) {
      void loadMoreChildren();
    }
  }, [virtualRows, hasMore, isLoadingMoreChildren, items.length, loadMoreChildren]);

  const handleToggleSelectAll = () => {
    if (allVisibleSelected) {
      clearSelection();
    } else {
      selectNodes(items.map((item) => item.id));
    }
  };

  if (!childrenPage) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center text-[13px] text-neutral-500 dark:text-neutral-400">
        <Folder className="mb-2 h-8 w-8 opacity-40" aria-hidden="true" />
        <p className="font-medium text-neutral-700 dark:text-neutral-300">
          No folder scanned yet
        </p>
        <p className="mt-1 max-w-[260px] text-[12px]">
          Choose a folder, Home, or Macintosh HD from the toolbar to inspect
          physical APFS usage.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar: Parent back-nav + Search/Filter */}
      <div className="flex shrink-0 items-center gap-2 border-b border-black/[0.06] px-3 py-2 dark:border-white/[0.07]">
        {parentBreadcrumb && (
          <button
            type="button"
            onClick={() => void navigateBreadcrumb(parentBreadcrumb.id)}
            title={`Up to ${parentBreadcrumb.name}`}
            aria-label={`Navigate up to ${parentBreadcrumb.name}`}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-black/[0.08] bg-white/80 px-2 text-[11.5px] font-medium text-neutral-700 transition-colors hover:bg-black/[0.04] dark:border-white/[0.1] dark:bg-white/[0.05] dark:text-neutral-200 dark:hover:bg-white/[0.1]"
          >
            <ArrowUpLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="max-w-[90px] truncate">
              {parentBreadcrumb.name}
            </span>
          </button>
        )}

        <div className="relative flex-1">
          <label htmlFor={filterInputId} className="sr-only">
            Filter items in current folder
          </label>
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400"
            aria-hidden="true"
          />
          <input
            id={filterInputId}
            type="search"
            value={filterQuery}
            onChange={(e) => void setFilterQuery(e.target.value)}
            placeholder={`Filter ${childrenPage.parent.name}…`}
            className="h-7 w-full rounded-md border border-black/[0.09] bg-black/[0.03] pl-8 pr-7 text-[12px] text-neutral-900 placeholder:text-neutral-400 focus:border-blue-500/50 focus:bg-white dark:border-white/[0.1] dark:bg-white/[0.05] dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:bg-neutral-900"
          />
          {filterQuery && (
            <button
              type="button"
              onClick={() => void setFilterQuery("")}
              aria-label="Clear filter"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          )}
        </div>

        <span className="shrink-0 tabular-nums text-[11px] text-neutral-500 dark:text-neutral-400">
          {formatCount(totalCount)} {totalCount === 1 ? "item" : "items"}
        </span>
      </div>

      {/* Column Headers */}
      <div
        role="row"
        className="grid shrink-0 select-none grid-cols-[26px_minmax(0,1fr)_96px_78px_56px_54px] items-center gap-2 border-b border-black/[0.06] bg-black/[0.02] px-3 py-1.5 dark:border-white/[0.07] dark:bg-white/[0.02]"
      >
        <div className="flex items-center justify-center">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            ref={(el) => {
              if (el) {
                el.indeterminate = someVisibleSelected && !allVisibleSelected;
              }
            }}
            onChange={handleToggleSelectAll}
            aria-label="Select all visible items"
            className="h-3.5 w-3.5 rounded border-neutral-300 dark:border-neutral-600"
          />
        </div>
        <div
          aria-sort={
            sortBy === "name"
              ? sortDir === "asc"
                ? "ascending"
                : "descending"
              : "none"
          }
        >
          <SortHeaderButton
            field="name"
            label="Name"
            activeField={sortBy}
            sortDir={sortDir}
            onSort={(f) => void setSort(f)}
          />
        </div>
        <div
          className="flex justify-end"
          aria-sort={
            sortBy === "physicalBytes"
              ? sortDir === "asc"
                ? "ascending"
                : "descending"
              : "none"
          }
        >
          <SortHeaderButton
            field="physicalBytes"
            label="Physical"
            align="right"
            activeField={sortBy}
            sortDir={sortDir}
            onSort={(f) => void setSort(f)}
          />
        </div>
        <div
          className="flex justify-end"
          aria-sort={
            sortBy === "logicalBytes"
              ? sortDir === "asc"
                ? "ascending"
                : "descending"
              : "none"
          }
        >
          <SortHeaderButton
            field="logicalBytes"
            label="Logical"
            align="right"
            activeField={sortBy}
            sortDir={sortDir}
            onSort={(f) => void setSort(f)}
          />
        </div>
        <div
          className="flex justify-end"
          aria-sort={
            sortBy === "fileCount"
              ? sortDir === "asc"
                ? "ascending"
                : "descending"
              : "none"
          }
        >
          <SortHeaderButton
            field="fileCount"
            label="Items"
            align="right"
            activeField={sortBy}
            sortDir={sortDir}
            onSort={(f) => void setSort(f)}
          />
        </div>
        <span className="sr-only">Actions</span>
      </div>

      {/* Virtualized Rows Container */}
      <div
        ref={scrollContainerRef}
        onMouseLeave={() => setHoveredNode(null)}
        className="mac-scroll min-h-0 flex-1 overflow-y-auto"
      >
        {items.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center text-center text-[12px] text-neutral-500 dark:text-neutral-400">
            <p>
              {filterQuery
                ? `No items matching "${filterQuery}"`
                : "This folder is empty."}
            </p>
          </div>
        ) : (
          <div
            role="list"
            aria-label={`Contents of ${childrenPage.parent.name}`}
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualRows.map((virtualRow) => {
              const item = items[virtualRow.index];
              if (!item) return null;

              const isSelected = selectedNodeIds.has(item.id);
              const isHovered = hoveredNodeId === item.id;
              const sparse = isSparseFile(
                item.physicalBytes,
                item.logicalBytes,
              );
              const pctWidth = Math.min(100, Math.max(0, item.percentOfParent));

              return (
                <div
                  key={item.id}
                  role="listitem"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  onMouseEnter={() => setHoveredNode(item.id)}
                  onClick={() => toggleSelectNode(item.id)}
                  onDoubleClick={() => {
                    if (item.isDir && !item.permissionDenied) {
                      void drillDown(item.id);
                    }
                  }}
                  className={`group grid cursor-default select-none grid-cols-[26px_minmax(0,1fr)_96px_78px_56px_54px] items-center gap-2 border-b border-black/[0.04] px-3 text-[12px] transition-colors dark:border-white/[0.04] ${
                    isSelected
                      ? "bg-blue-500/[0.12] dark:bg-blue-500/[0.2]"
                      : isHovered
                        ? "bg-black/[0.04] dark:bg-white/[0.06]"
                        : "hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                  }`}
                >
                  {/* Checkbox */}
                  <div
                    className="flex items-center justify-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectNode(item.id)}
                      aria-label={`Select ${item.name}`}
                      className="h-3.5 w-3.5 rounded border-neutral-300 dark:border-neutral-600"
                    />
                  </div>

                  {/* Name & Badges */}
                  <div className="flex min-w-0 items-center gap-2">
                    <NodeIcon item={item} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {item.isDir && !item.permissionDenied ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void drillDown(item.id);
                            }}
                            title={item.path}
                            className="truncate text-left font-medium text-neutral-900 hover:text-blue-600 hover:underline dark:text-neutral-100 dark:hover:text-blue-400"
                          >
                            {item.name}
                          </button>
                        ) : (
                          <span
                            title={item.path}
                            className="truncate text-neutral-800 dark:text-neutral-200"
                          >
                            {item.name}
                          </span>
                        )}

                        {sparse && (
                          <span
                            title={`APFS sparse file: ${formatBytes(item.physicalBytes)} allocated on disk vs ${formatBytes(item.logicalBytes)} logical`}
                            className="shrink-0 rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-medium text-cyan-800 dark:bg-cyan-400/15 dark:text-cyan-300"
                          >
                            Sparse
                          </span>
                        )}

                        {item.isHardlinkDup && (
                          <span
                            title="Deduplicated hard link (0 additional physical bytes counted)"
                            className="shrink-0 rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-medium text-purple-800 dark:bg-purple-400/15 dark:text-purple-300"
                          >
                            Hardlink
                          </span>
                        )}

                        {item.permissionDenied && (
                          <span
                            title="Permission denied by macOS TCC or POSIX permissions"
                            className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-400/15 dark:text-amber-300"
                          >
                            Locked
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Physical Size + Proportional Bar */}
                  <div className="flex flex-col items-end justify-center tabular-nums">
                    <span className="font-medium leading-tight text-neutral-900 dark:text-neutral-100">
                      {formatBytes(item.physicalBytes)}
                    </span>
                    <div className="mt-0.5 flex w-full items-center gap-1">
                      <div
                        className="h-1 flex-1 overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.09]"
                        aria-hidden="true"
                      >
                        <div
                          className="h-full rounded-full bg-blue-500/80 dark:bg-blue-400/80"
                          style={{ width: `${pctWidth}%` }}
                        />
                      </div>
                      <span className="w-8 text-right text-[10px] text-neutral-500 dark:text-neutral-400">
                        {formatPercent(item.percentOfParent)}
                      </span>
                    </div>
                  </div>

                  {/* Logical Size */}
                  <div className="text-right tabular-nums text-[11.5px] text-neutral-500 dark:text-neutral-400">
                    {formatBytes(item.logicalBytes)}
                  </div>

                  {/* Item Count */}
                  <div className="text-right tabular-nums text-[11.5px] text-neutral-500 dark:text-neutral-400">
                    {item.isDir ? formatCount(item.fileCount) : "—"}
                  </div>

                  {/* Quick Row Actions */}
                  <div
                    className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => void revealInFinder(item.id)}
                      aria-label={`Reveal ${item.name} in Finder`}
                      title="Reveal in Finder"
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-black/[0.08] hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/[0.12] dark:hover:text-neutral-100"
                    >
                      <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openDeleteModal([item])}
                      aria-label={`Move ${item.name} to Trash`}
                      title="Move to Trash"
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-red-500/15 hover:text-red-600 dark:text-neutral-400 dark:hover:bg-red-500/20 dark:hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
