import { listen } from "@tauri-apps/api/event";
import {
  AlertCircle,
  CheckCircle2,
  FolderOpen,
  FolderTree,
  Info,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo } from "react";
import { FdaBanner } from "./components/layout/FdaBanner";
import { ScanProgressBar } from "./components/layout/ScanProgressBar";
import { TitleBar } from "./components/layout/TitleBar";
import { AboutModal } from "./components/modals/AboutModal";
import { DeleteConfirmModal } from "./components/modals/DeleteConfirmModal";
import { DevPresetsPanel } from "./components/presets/DevPresetsPanel";
import { VirtualizedDirectoryTree } from "./components/tree/VirtualizedDirectoryTree";
import { VizContainer } from "./components/viz";
import {
  formatBytes,
  formatBytesCompact,
  formatCount,
  formatDurationMs,
  isArtifactDirectory,
} from "./lib/format";
import { isTauriRuntime } from "./lib/ipc/client";
import type {
  ArtifactGroupDto,
  NodeKey,
  NodeSummaryDto,
  SubtreeNodeDto,
} from "./lib/ipc/types";
import { useSweepStore } from "./store/useSweepStore";

function findSubtreeNode(
  root: SubtreeNodeDto | null,
  nodeId: NodeKey,
): SubtreeNodeDto | null {
  if (!root) return null;
  if (root.id === nodeId) return root;
  for (const child of root.children) {
    const match = findSubtreeNode(child, nodeId);
    if (match) return match;
  }
  return null;
}

function resolveNodeSummary(
  nodeId: NodeKey,
  listItems: NodeSummaryDto[],
  artifactGroups: ArtifactGroupDto[],
  vizSubtree: SubtreeNodeDto | null,
): NodeSummaryDto | null {
  const fromList = listItems.find((item) => item.id === nodeId);
  if (fromList) return fromList;

  for (const group of artifactGroups) {
    const match = group.items.find((item) => item.nodeId === nodeId);
    if (match) {
      return {
        id: match.nodeId,
        parentId: null,
        name: match.projectName
          ? `${match.projectName} / ${match.name}`
          : match.name,
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
  }

  const fromSubtree = findSubtreeNode(vizSubtree, nodeId);
  if (fromSubtree) {
    return {
      id: fromSubtree.id,
      parentId: null,
      name: fromSubtree.name,
      path: fromSubtree.path,
      isDir: fromSubtree.isDir,
      isSymlink: false,
      isHardlinkDup: fromSubtree.isHardlinkDup,
      permissionDenied: false,
      physicalBytes: fromSubtree.physicalBytes,
      logicalBytes: fromSubtree.logicalBytes,
      fileCount: fromSubtree.fileCount,
      dirCount: 0,
      modifiedSecs: null,
      category: fromSubtree.category,
      percentOfParent: 0,
    };
  }

  return null;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export default function App() {
  const explorerTabId = useId();
  const presetsTabId = useId();
  const explorerPanelId = useId();
  const presetsPanelId = useId();

  const bootstrap = useSweepStore((s) => s.bootstrap);
  const scanStatus = useSweepStore((s) => s.scanStatus);
  const scanSummary = useSweepStore((s) => s.scanSummary);
  const scanError = useSweepStore((s) => s.scanError);
  const breadcrumbs = useSweepStore((s) => s.breadcrumbs);
  const vizMode = useSweepStore((s) => s.vizMode);
  const vizSubtree = useSweepStore((s) => s.vizSubtree);
  const childrenPage = useSweepStore((s) => s.childrenPage);
  const selectedNodeIds = useSweepStore((s) => s.selectedNodeIds);
  const hoveredNodeId = useSweepStore((s) => s.hoveredNodeId);
  const activeTab = useSweepStore((s) => s.activeTab);
  const artifactGroups = useSweepStore((s) => s.artifactGroups);
  const pendingDeleteTargets = useSweepStore((s) => s.pendingDeleteTargets);
  const deleteModalOpen = useSweepStore((s) => s.deleteModalOpen);
  const isDeleting = useSweepStore((s) => s.isDeleting);
  const lastDeleteResult = useSweepStore((s) => s.lastDeleteResult);
  const aboutModalOpen = useSweepStore((s) => s.aboutModalOpen);
  const toast = useSweepStore((s) => s.toast);

  const pickAndScan = useSweepStore((s) => s.pickAndScan);
  const setVizMode = useSweepStore((s) => s.setVizMode);
  const setActiveTab = useSweepStore((s) => s.setActiveTab);
  const setHoveredNode = useSweepStore((s) => s.setHoveredNode);
  const selectNodes = useSweepStore((s) => s.selectNodes);
  const clearSelection = useSweepStore((s) => s.clearSelection);
  const drillDown = useSweepStore((s) => s.drillDown);
  const navigateBreadcrumb = useSweepStore((s) => s.navigateBreadcrumb);
  const openDeleteModal = useSweepStore((s) => s.openDeleteModal);
  const closeDeleteModal = useSweepStore((s) => s.closeDeleteModal);
  const confirmDelete = useSweepStore((s) => s.confirmDelete);
  const openAboutModal = useSweepStore((s) => s.openAboutModal);
  const closeAboutModal = useSweepStore((s) => s.closeAboutModal);
  const revealInFinder = useSweepStore((s) => s.revealInFinder);
  const dismissToast = useSweepStore((s) => s.dismissToast);

  // Non-blocking startup FDA probe & disk capacity fetch
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Listen for native macOS "Mac Sweep -> About Mac Sweep" menu events
  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlisten: (() => void) | undefined;
    let active = true;

    void listen("open-about-modal", () => {
      openAboutModal();
    }).then((fn) => {
      if (active) {
        unlisten = fn;
      } else {
        fn();
      }
    });

    return () => {
      active = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, [openAboutModal]);

  // Auto-dismiss transient toast notifications after 5.5s
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      dismissToast();
    }, 5500);
    return () => clearTimeout(timer);
  }, [toast, dismissToast]);

  const listItems = childrenPage?.items ?? [];

  const selectedTargets = useMemo(() => {
    const resolved: NodeSummaryDto[] = [];
    for (const id of selectedNodeIds) {
      const summary = resolveNodeSummary(
        id,
        listItems,
        artifactGroups,
        vizSubtree,
      );
      if (summary) {
        resolved.push(summary);
      }
    }
    return resolved;
  }, [selectedNodeIds, listItems, artifactGroups, vizSubtree]);

  const selectedPhysicalBytes = useMemo(
    () => selectedTargets.reduce((sum, item) => sum + item.physicalBytes, 0),
    [selectedTargets],
  );

  const primarySelectedId: NodeKey | null = useMemo(() => {
    if (selectedNodeIds.size === 0) return null;
    return selectedNodeIds.values().next().value ?? null;
  }, [selectedNodeIds]);

  const presetStats = useMemo(() => {
    let count = 0;
    let bytes = 0;
    for (const group of artifactGroups) {
      count += group.itemCount;
      bytes += group.totalPhysicalBytes;
    }
    return { count, bytes };
  }, [artifactGroups]);

  const handleVizContextAction = useCallback(
    (action: "zoom" | "reveal" | "trash", nodeId: NodeKey) => {
      switch (action) {
        case "zoom":
          void drillDown(nodeId);
          break;
        case "reveal":
          void revealInFinder(nodeId);
          break;
        case "trash": {
          const target = resolveNodeSummary(
            nodeId,
            listItems,
            artifactGroups,
            vizSubtree,
          );
          if (target) {
            openDeleteModal([target]);
          }
          break;
        }
      }
    },
    [
      drillDown,
      revealInFinder,
      listItems,
      artifactGroups,
      vizSubtree,
      openDeleteModal,
    ],
  );

  // macOS Desktop Keyboard Shortcuts
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key.toLowerCase() === "o") {
        event.preventDefault();
        if (scanStatus !== "scanning") {
          void pickAndScan();
        }
        return;
      }

      if (mod && event.key === "1") {
        event.preventDefault();
        setVizMode("treemap");
        return;
      }

      if (mod && event.key === "2") {
        event.preventDefault();
        setVizMode("sunburst");
        return;
      }

      if (mod && event.key === "Backspace") {
        if (isEditableTarget(event.target) || deleteModalOpen || aboutModalOpen) {
          return;
        }
        if (selectedTargets.length > 0) {
          event.preventDefault();
          openDeleteModal(selectedTargets);
        }
        return;
      }

      if (event.key === "Escape") {
        if (aboutModalOpen) {
          closeAboutModal();
        } else if (deleteModalOpen) {
          closeDeleteModal();
        } else if (!isEditableTarget(event.target) && selectedNodeIds.size > 0) {
          clearSelection();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    scanStatus,
    pickAndScan,
    setVizMode,
    aboutModalOpen,
    closeAboutModal,
    deleteModalOpen,
    selectedTargets,
    openDeleteModal,
    closeDeleteModal,
    selectedNodeIds.size,
    clearSelection,
  ]);

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      setActiveTab(activeTab === "explorer" ? "presets" : "explorer");
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-neutral-100/90 text-neutral-900 dark:bg-neutral-950/90 dark:text-neutral-100">
      {/* Native macOS Overlay Title Bar */}
      <TitleBar />

      {/* Non-blocking Full Disk Access Permission Banner */}
      <FdaBanner />

      {/* Live Scan Throughput Strip */}
      <ScanProgressBar />

      {/* Scan Error Banner */}
      {scanStatus === "error" && scanError && (
        <div
          role="alert"
          className="flex shrink-0 items-center justify-between gap-3 border-b border-red-500/25 bg-red-500/[0.09] px-4 py-2 text-[12px] text-red-900 dark:border-red-400/20 dark:bg-red-500/[0.12] dark:text-red-100"
        >
          <div className="flex items-center gap-2">
            <AlertCircle
              className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
              aria-hidden="true"
            />
            <span>
              <strong className="font-semibold">Scan failed ({scanError.code}):</strong>{" "}
              {scanError.message}
            </span>
          </div>
        </div>
      )}

      {/* Split-Pane Main Workspace */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left / Main Visualization Pane */}
        <main className="flex min-w-0 flex-1 flex-col p-3">
          <VizContainer
            subtree={vizSubtree}
            vizMode={vizMode}
            onVizModeChange={setVizMode}
            breadcrumbs={breadcrumbs}
            selectedNodeId={primarySelectedId}
            hoveredNodeId={hoveredNodeId}
            onHoverNode={setHoveredNode}
            onSelectNode={(id) => (id ? selectNodes([id]) : clearSelection())}
            onDrillDown={(id) => void drillDown(id)}
            onNavigateBreadcrumb={(id) => void navigateBreadcrumb(id)}
            onContextAction={handleVizContextAction}
          />
        </main>

        {/* Right Explorer / Dev Presets Sidebar */}
        <aside
          aria-label="Directory explorer and developer cleanup presets"
          className="flex w-[440px] shrink-0 flex-col border-l border-black/[0.08] bg-white/75 backdrop-blur-xl dark:border-white/[0.08] dark:bg-neutral-900/75 lg:w-[490px] xl:w-[540px]"
        >
          {/* macOS Segmented Tab Switcher */}
          <div className="shrink-0 border-b border-black/[0.07] px-3 py-2 dark:border-white/[0.08]">
            <div
              role="tablist"
              aria-label="Inspector views"
              onKeyDown={handleTabKeyDown}
              className="grid grid-cols-2 rounded-lg bg-black/[0.06] p-0.5 dark:bg-white/[0.08]"
            >
              <button
                id={explorerTabId}
                type="button"
                role="tab"
                aria-selected={activeTab === "explorer"}
                aria-controls={explorerPanelId}
                tabIndex={activeTab === "explorer" ? 0 : -1}
                onClick={() => setActiveTab("explorer")}
                className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-all ${
                  activeTab === "explorer"
                    ? "bg-white text-neutral-900 shadow-xs dark:bg-neutral-800 dark:text-neutral-100"
                    : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200"
                }`}
              >
                <FolderTree className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Directory Explorer</span>
              </button>

              <button
                id={presetsTabId}
                type="button"
                role="tab"
                aria-selected={activeTab === "presets"}
                aria-controls={presetsPanelId}
                tabIndex={activeTab === "presets" ? 0 : -1}
                onClick={() => setActiveTab("presets")}
                className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-all ${
                  activeTab === "presets"
                    ? "bg-white text-neutral-900 shadow-xs dark:bg-neutral-800 dark:text-neutral-100"
                    : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200"
                }`}
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Dev Presets</span>
                {presetStats.count > 0 && (
                  <span className="tabular-nums rounded-full bg-blue-500/15 px-1.5 py-0.2 text-[10.5px] font-semibold text-blue-700 dark:bg-blue-400/20 dark:text-blue-300">
                    {presetStats.count} · {formatBytesCompact(presetStats.bytes)}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Active Panel */}
          <div className="min-h-0 flex-1 overflow-hidden">
            <div
              id={explorerPanelId}
              role="tabpanel"
              aria-labelledby={explorerTabId}
              hidden={activeTab !== "explorer"}
              className="h-full"
            >
              {activeTab === "explorer" && <VirtualizedDirectoryTree />}
            </div>

            <div
              id={presetsPanelId}
              role="tabpanel"
              aria-labelledby={presetsTabId}
              hidden={activeTab !== "presets"}
              className="h-full"
            >
              {activeTab === "presets" && <DevPresetsPanel />}
            </div>
          </div>
        </aside>
      </div>

      {/* Persistent Bottom Action Bar */}
      <footer className="flex h-11 shrink-0 select-none items-center justify-between gap-4 border-t border-black/[0.08] bg-white/85 px-4 text-[12px] backdrop-blur-xl dark:border-white/[0.08] dark:bg-neutral-900/85">
        <div className="flex min-w-0 items-center gap-3 tabular-nums">
          {selectedTargets.length > 0 ? (
            <>
              <span className="font-medium text-neutral-900 dark:text-neutral-100">
                {formatCount(selectedTargets.length)}{" "}
                {selectedTargets.length === 1 ? "item" : "items"} ·{" "}
                {formatBytes(selectedPhysicalBytes)} physical
              </span>
              <button
                type="button"
                onClick={clearSelection}
                className="text-[11.5px] text-neutral-500 hover:text-neutral-900 hover:underline dark:text-neutral-400 dark:hover:text-neutral-200"
              >
                Clear
              </button>
            </>
          ) : scanSummary ? (
            <div className="flex min-w-0 items-center gap-2.5 text-[11.5px] text-neutral-600 dark:text-neutral-400">
              <span
                title={scanSummary.rootPath}
                className="font-mac-mono max-w-[220px] truncate font-medium text-neutral-800 dark:text-neutral-200"
              >
                {scanSummary.rootPath}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                <strong className="font-semibold text-neutral-900 dark:text-neutral-100">
                  {formatBytes(scanSummary.totalPhysicalBytes)}
                </strong>{" "}
                physical
              </span>
              <span aria-hidden="true">·</span>
              <span>{formatCount(scanSummary.totalFiles)} files</span>
              <span aria-hidden="true">·</span>
              <span>{formatDurationMs(scanSummary.durationMs)}</span>
              {scanSummary.hardlinkDedupBytes > 0 && (
                <span className="hidden rounded-full bg-purple-500/10 px-2 py-0.5 text-[10.5px] text-purple-800 dark:bg-purple-400/15 dark:text-purple-300 md:inline">
                  {formatBytesCompact(scanSummary.hardlinkDedupBytes)} hardlinks deduplicated
                </span>
              )}
            </div>
          ) : (
            <span className="text-[11.5px] text-neutral-500 dark:text-neutral-400">
              Ready — press <kbd className="rounded border border-black/15 px-1 text-[10.5px] dark:border-white/20">⌘O</kbd> to scan a folder or choose Home / Macintosh HD
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={selectedTargets.length !== 1}
            onClick={() => {
              const single = selectedTargets[0];
              if (single) {
                void revealInFinder(single.id);
              }
            }}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-black/[0.1] bg-white/80 px-2.5 text-[12px] font-medium text-neutral-700 transition-colors hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[0.12] dark:bg-white/[0.06] dark:text-neutral-200 dark:hover:bg-white/[0.1]"
          >
            <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Reveal in Finder</span>
          </button>

          <button
            type="button"
            disabled={selectedTargets.length === 0}
            onClick={() => openDeleteModal(selectedTargets)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-[12px] font-medium text-white shadow-xs transition-colors hover:bg-blue-700 active:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-blue-500 dark:hover:bg-blue-400"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Move to Trash</span>
            <kbd className="ml-0.5 hidden rounded bg-white/20 px-1 text-[10px] font-medium text-white/90 sm:inline">
              ⌘⌫
            </kbd>
          </button>
        </div>
      </footer>

      {/* Polite Toast Notification */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed bottom-14 right-4 z-40 flex max-w-sm flex-col gap-2"
      >
        {toast && (
          <div
            role="status"
            className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-black/[0.12] bg-white/95 px-3.5 py-2.5 text-[12px] text-neutral-900 shadow-lg backdrop-blur-xl dark:border-white/[0.14] dark:bg-neutral-900/95 dark:text-neutral-100"
          >
            {toast.tone === "success" && (
              <CheckCircle2
                className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                aria-hidden="true"
              />
            )}
            {toast.tone === "error" && (
              <AlertCircle
                className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
                aria-hidden="true"
              />
            )}
            {toast.tone === "warning" && (
              <AlertCircle
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                aria-hidden="true"
              />
            )}
            {toast.tone === "info" && (
              <Info
                className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400"
                aria-hidden="true"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-semibold leading-snug">{toast.title}</div>
              {toast.detail && (
                <div className="mt-0.5 text-[11.5px] text-neutral-600 dark:text-neutral-400">
                  {toast.detail}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={dismissToast}
              aria-label="Dismiss notification"
              className="rounded p-0.5 text-neutral-400 hover:bg-black/[0.06] hover:text-neutral-700 dark:hover:bg-white/[0.08] dark:hover:text-neutral-200"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {/* Native Safe Deletion Confirmation Modal */}
      <DeleteConfirmModal
        open={deleteModalOpen}
        targets={pendingDeleteTargets}
        isDeleting={isDeleting}
        lastResult={lastDeleteResult}
        onConfirm={(mode) => confirmDelete(mode)}
        onClose={closeDeleteModal}
      />

      {/* About & In-App Changelog Modal */}
      <AboutModal open={aboutModalOpen} onClose={closeAboutModal} />
    </div>
  );
}
