import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  formatBytes,
  formatCount,
  formatRelativeTime,
  isArtifactDirectory,
  isSparseFile,
} from "../../lib/format";
import type {
  ArtifactGroupDto,
  ArtifactMatchDto,
  NodeKey,
  NodeSummaryDto,
} from "../../lib/ipc/types";
import { useSweepStore } from "../../store/useSweepStore";

function artifactToNodeSummary(match: ArtifactMatchDto): NodeSummaryDto {
  return {
    id: match.nodeId,
    parentId: null,
    name: match.projectName ? `${match.projectName} / ${match.name}` : match.name,
    path: match.path,
    isDir: isArtifactDirectory(match.name),
    isSymlink: false,
    isHardlinkDup: false,
    permissionDenied: false,
    physicalBytes: match.physicalBytes,
    logicalBytes: match.logicalBytes,
    fileCount: match.fileCount,
    dirCount: 0,
    modifiedSecs: match.modifiedSecs,
    category: "code",
    percentOfParent: 0,
  };
}

export function DevPresetsPanel() {
  const artifactGroups = useSweepStore((s) => s.artifactGroups);
  const scanStatus = useSweepStore((s) => s.scanStatus);
  const selectedNodeIds = useSweepStore((s) => s.selectedNodeIds);
  const hoveredNodeId = useSweepStore((s) => s.hoveredNodeId);

  const toggleSelectNode = useSweepStore((s) => s.toggleSelectNode);
  const selectNodes = useSweepStore((s) => s.selectNodes);
  const setHoveredNode = useSweepStore((s) => s.setHoveredNode);
  const openDeleteModal = useSweepStore((s) => s.openDeleteModal);
  const revealInFinder = useSweepStore((s) => s.revealInFinder);

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    {},
  );

  const totals = useMemo(() => {
    let totalBytes = 0;
    let totalItems = 0;
    let safeBytes = 0;
    const safeMatches: ArtifactMatchDto[] = [];

    for (const group of artifactGroups) {
      totalBytes += group.totalPhysicalBytes;
      totalItems += group.itemCount;
      if (group.risk === "safe") {
        safeBytes += group.totalPhysicalBytes;
        safeMatches.push(...group.items);
      }
    }
    return { totalBytes, totalItems, safeBytes, safeMatches };
  }, [artifactGroups]);

  const selectedMatches = useMemo(() => {
    const result: ArtifactMatchDto[] = [];
    for (const group of artifactGroups) {
      for (const item of group.items) {
        if (selectedNodeIds.has(item.nodeId)) {
          result.push(item);
        }
      }
    }
    return result;
  }, [artifactGroups, selectedNodeIds]);

  const toggleGroupExpand = (groupId: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupId]: !(prev[groupId] ?? true),
    }));
  };

  const toggleSelectGroup = (group: ArtifactGroupDto) => {
    const groupIds = group.items.map((item) => item.nodeId);
    const allSelected =
      groupIds.length > 0 && groupIds.every((id) => selectedNodeIds.has(id));

    const next = new Set<NodeKey>(selectedNodeIds);
    if (allSelected) {
      for (const id of groupIds) {
        next.delete(id);
      }
    } else {
      for (const id of groupIds) {
        next.add(id);
      }
    }
    selectNodes([...next]);
  };

  if (artifactGroups.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center text-[13px] text-neutral-500 dark:text-neutral-400">
        <Sparkles className="mb-2 h-8 w-8 opacity-40" aria-hidden="true" />
        <p className="font-medium text-neutral-700 dark:text-neutral-300">
          {scanStatus === "completed"
            ? "No developer artifacts found"
            : "Developer cleanup presets"}
        </p>
        <p className="mt-1 max-w-[270px] text-[12px]">
          {scanStatus === "completed"
            ? "This scan didn't detect node_modules, Cargo targets, Xcode DerivedData, or caches."
            : "Run a scan to automatically detect reclaimable Xcode, Cargo, Node, Homebrew, and Docker caches."}
        </p>
      </div>
    );
  }

  const selectedBytes = selectedMatches.reduce(
    (sum, item) => sum + item.physicalBytes,
    0,
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Reclaimable Summary Header */}
      <div className="shrink-0 border-b border-black/[0.06] bg-gradient-to-b from-blue-500/[0.05] to-transparent px-3.5 py-3 dark:border-white/[0.07] dark:from-blue-400/[0.07]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Reclaimable Dev Artifacts
            </p>
            <div className="mt-0.5 flex items-baseline gap-2 tabular-nums">
              <span className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
                {formatBytes(totals.totalBytes)}
              </span>
              <span className="text-[11.5px] text-neutral-500 dark:text-neutral-400">
                across {formatCount(totals.totalItems)}{" "}
                {totals.totalItems === 1 ? "location" : "locations"}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {selectedMatches.length > 0 ? (
              <button
                type="button"
                onClick={() =>
                  openDeleteModal(selectedMatches.map(artifactToNodeSummary))
                }
                className="inline-flex h-7 items-center gap-1.5 rounded-md bg-blue-600 px-2.5 text-[11.5px] font-medium text-white shadow-xs transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  Clean Selected ({formatBytes(selectedBytes)})
                </span>
              </button>
            ) : (
              totals.safeMatches.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    openDeleteModal(
                      totals.safeMatches.map(artifactToNodeSummary),
                    )
                  }
                  className="inline-flex h-7 items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 text-[11.5px] font-medium text-white shadow-xs transition-colors hover:bg-emerald-700 dark:bg-emerald-500 dark:text-neutral-950 dark:hover:bg-emerald-400"
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Clean Safe ({formatBytes(totals.safeBytes)})</span>
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {/* Grouped Preset Cards */}
      <div className="mac-scroll min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
        {artifactGroups.map((group) => {
          const isExpanded = expandedGroups[group.id] ?? true;
          const allGroupSelected =
            group.items.length > 0 &&
            group.items.every((item) => selectedNodeIds.has(item.nodeId));
          const isCaution = group.risk === "caution";

          return (
            <section
              key={group.id}
              className="overflow-hidden rounded-lg border border-black/[0.08] bg-white/80 shadow-2xs dark:border-white/[0.08] dark:bg-white/[0.03]"
            >
              {/* Group Header */}
              <div className="flex items-start justify-between gap-2 px-3 py-2.5">
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  onClick={() => toggleGroupExpand(group.id)}
                  className="flex min-w-0 flex-1 items-start gap-2 text-left"
                >
                  <span className="mt-0.5 text-neutral-400">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="text-[12.5px] font-semibold text-neutral-900 dark:text-neutral-100">
                        {group.label}
                      </h3>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                          isCaution
                            ? "bg-amber-500/15 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300"
                            : "bg-emerald-500/15 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300"
                        }`}
                      >
                        {isCaution ? (
                          <AlertTriangle
                            className="h-2.5 w-2.5"
                            aria-hidden="true"
                          />
                        ) : (
                          <CheckCircle2
                            className="h-2.5 w-2.5"
                            aria-hidden="true"
                          />
                        )}
                        <span>{isCaution ? "Caution" : "Safe"}</span>
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-neutral-500 dark:text-neutral-400">
                      {group.description}
                    </p>
                  </div>
                </button>

                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span className="tabular-nums text-[12.5px] font-semibold text-neutral-900 dark:text-neutral-100">
                    {formatBytes(group.totalPhysicalBytes)}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => toggleSelectGroup(group)}
                      className="rounded border border-black/[0.09] px-1.5 py-0.5 text-[10.5px] font-medium text-neutral-700 hover:bg-black/[0.05] dark:border-white/[0.1] dark:text-neutral-300 dark:hover:bg-white/[0.08]"
                    >
                      {allGroupSelected ? "Deselect" : "Select All"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        openDeleteModal(group.items.map(artifactToNodeSummary))
                      }
                      className="rounded bg-black/[0.06] px-1.5 py-0.5 text-[10.5px] font-medium text-neutral-800 hover:bg-red-500/15 hover:text-red-700 dark:bg-white/[0.08] dark:text-neutral-200 dark:hover:bg-red-500/20 dark:hover:text-red-300"
                    >
                      Clean Group
                    </button>
                  </div>
                </div>
              </div>

              {/* Expanded Matches */}
              {isExpanded && (
                <ul className="divide-y divide-black/[0.05] border-t border-black/[0.06] dark:divide-white/[0.05] dark:border-white/[0.06]">
                  {group.items.map((match) => {
                    const isSelected = selectedNodeIds.has(match.nodeId);
                    const isHovered = hoveredNodeId === match.nodeId;
                    const sparse = isSparseFile(
                      match.physicalBytes,
                      match.logicalBytes,
                    );

                    return (
                      <li
                        key={match.nodeId}
                        onMouseEnter={() => setHoveredNode(match.nodeId)}
                        onMouseLeave={() => setHoveredNode(null)}
                        className={`group flex items-center gap-2.5 px-3 py-2 text-[12px] transition-colors ${
                          isSelected
                            ? "bg-blue-500/[0.1] dark:bg-blue-500/[0.18]"
                            : isHovered
                              ? "bg-black/[0.03] dark:bg-white/[0.05]"
                              : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectNode(match.nodeId)}
                          aria-label={`Select ${match.projectName ?? match.name}`}
                          className="h-3.5 w-3.5 shrink-0 rounded border-neutral-300 dark:border-neutral-600"
                        />

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {match.projectName && (
                              <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                                {match.projectName}
                              </span>
                            )}
                            <span className="truncate text-neutral-600 dark:text-neutral-300">
                              {match.projectName ? `· ${match.name}` : match.name}
                            </span>
                            {sparse && (
                              <span className="shrink-0 rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-medium text-cyan-800 dark:text-cyan-300">
                                Sparse ({formatBytes(match.logicalBytes)} logical)
                              </span>
                            )}
                          </div>
                          <div
                            title={match.path}
                            className="font-mac-mono mt-0.5 truncate text-[10.5px] text-neutral-500 dark:text-neutral-400"
                          >
                            {match.path}
                          </div>
                        </div>

                        <div className="shrink-0 text-right tabular-nums">
                          <div className="font-medium text-neutral-900 dark:text-neutral-100">
                            {formatBytes(match.physicalBytes)}
                          </div>
                          <div className="text-[10.5px] text-neutral-500 dark:text-neutral-400">
                            {formatRelativeTime(match.modifiedSecs)}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => void revealInFinder(match.nodeId)}
                            aria-label={`Reveal ${match.name} in Finder`}
                            title="Reveal in Finder"
                            className="inline-flex h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-black/[0.08] hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/[0.12] dark:hover:text-neutral-100"
                          >
                            <FolderOpen
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              openDeleteModal([artifactToNodeSummary(match)])
                            }
                            aria-label={`Move ${match.name} to Trash`}
                            title="Move to Trash"
                            className="inline-flex h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-red-500/15 hover:text-red-600 dark:text-neutral-400 dark:hover:bg-red-500/20 dark:hover:text-red-400"
                          >
                            <Trash2
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
