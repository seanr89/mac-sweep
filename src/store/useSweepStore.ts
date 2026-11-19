import { create } from "zustand";
import { formatBytes } from "../lib/format";
import { getIpcClient, normalizeIpcError } from "../lib/ipc/client";
import type {
  AppErrorPayload,
  ArtifactGroupDto,
  BreadcrumbDto,
  DeleteMode,
  DeleteResult,
  DiskOverview,
  FdaStatus,
  NodeChildrenPage,
  NodeKey,
  NodeSummaryDto,
  ScanEvent,
  SortDirection,
  SortField,
  SubtreeNodeDto,
  VizMode,
} from "../lib/ipc/types";

export type ScanStatus =
  | "idle"
  | "scanning"
  | "completed"
  | "cancelled"
  | "error";

export type ActiveTab = "explorer" | "presets";

export interface ScanProgressState {
  scanId: number;
  filesScanned: number;
  dirsScanned: number;
  physicalBytes: number;
  logicalBytes: number;
  permissionErrors: number;
  currentPath: string;
  elapsedMs: number;
}

export interface ScanSummaryState {
  scanId: number;
  rootId: NodeKey;
  rootPath: string;
  totalFiles: number;
  totalDirs: number;
  totalPhysicalBytes: number;
  totalLogicalBytes: number;
  hardlinkDedupBytes: number;
  permissionErrors: number;
  durationMs: number;
}

export interface ToastNotice {
  id: number;
  tone: "success" | "warning" | "error" | "info";
  title: string;
  detail?: string;
}

const DEFAULT_CHILDREN_LIMIT = 500;
const DEFAULT_SUBTREE_DEPTH = 4;
const DEFAULT_SUBTREE_MAX_CHILDREN = 40;

let nextToastId = 1;
let navigationSeq = 0;

export interface SweepState {
  fdaStatus: FdaStatus | null;
  fdaBannerDismissed: boolean;
  diskOverview: DiskOverview | null;

  scanStatus: ScanStatus;
  activeScanId: number | null;
  scanProgress: ScanProgressState | null;
  scanSummary: ScanSummaryState | null;
  scanError: AppErrorPayload | null;

  rootNodeId: NodeKey | null;
  currentNodeId: NodeKey | null;
  breadcrumbs: BreadcrumbDto[];

  vizMode: VizMode;
  vizSubtree: SubtreeNodeDto | null;

  childrenPage: NodeChildrenPage | null;
  isLoadingMoreChildren: boolean;
  sortBy: SortField;
  sortDir: SortDirection;
  filterQuery: string;

  selectedNodeIds: Set<NodeKey>;
  hoveredNodeId: NodeKey | null;

  activeTab: ActiveTab;
  artifactGroups: ArtifactGroupDto[];

  pendingDeleteTargets: NodeSummaryDto[];
  deleteModalOpen: boolean;
  isDeleting: boolean;
  lastDeleteResult: DeleteResult | null;

  toast: ToastNotice | null;
}

export interface SweepActions {
  bootstrap: () => Promise<void>;
  openFdaSettings: () => Promise<void>;
  recheckFda: () => Promise<void>;
  dismissFdaBanner: () => void;

  scanDirectory: (path: string) => Promise<void>;
  pickAndScan: () => Promise<void>;
  cancelScan: () => Promise<void>;

  drillDown: (nodeId: NodeKey) => Promise<void>;
  navigateBreadcrumb: (nodeId: NodeKey) => Promise<void>;
  loadMoreChildren: () => Promise<void>;

  setSort: (field: SortField) => Promise<void>;
  setFilterQuery: (q: string) => Promise<void>;

  toggleSelectNode: (id: NodeKey) => void;
  selectNodes: (ids: NodeKey[]) => void;
  clearSelection: () => void;
  setHoveredNode: (id: NodeKey | null) => void;

  setVizMode: (mode: VizMode) => void;
  setActiveTab: (tab: ActiveTab) => void;

  openDeleteModal: (targets: NodeSummaryDto[]) => void;
  closeDeleteModal: () => void;
  confirmDelete: (mode: DeleteMode) => Promise<DeleteResult | null>;

  revealInFinder: (nodeId: NodeKey) => Promise<void>;
  dismissToast: () => void;
  resetStore: () => void;
}

export type SweepStore = SweepState & SweepActions;

function createInitialState(): SweepState {
  return {
    fdaStatus: null,
    fdaBannerDismissed: false,
    diskOverview: null,

    scanStatus: "idle",
    activeScanId: null,
    scanProgress: null,
    scanSummary: null,
    scanError: null,

    rootNodeId: null,
    currentNodeId: null,
    breadcrumbs: [],

    vizMode: "treemap",
    vizSubtree: null,

    childrenPage: null,
    isLoadingMoreChildren: false,
    sortBy: "physicalBytes",
    sortDir: "desc",
    filterQuery: "",

    selectedNodeIds: new Set<NodeKey>(),
    hoveredNodeId: null,

    activeTab: "explorer",
    artifactGroups: [],

    pendingDeleteTargets: [],
    deleteModalOpen: false,
    isDeleting: false,
    lastDeleteResult: null,

    toast: null,
  };
}

function findNodeInSubtree(
  node: SubtreeNodeDto | null,
  targetId: NodeKey,
): SubtreeNodeDto | null {
  if (!node) return null;
  if (node.id === targetId) return node;
  for (const child of node.children) {
    const found = findNodeInSubtree(child, targetId);
    if (found) return found;
  }
  return null;
}

export const useSweepStore = create<SweepStore>((set, get) => {
  const loadNodeView = async (
    nodeId: NodeKey,
    options?: {
      refreshArtifacts?: boolean;
      refreshDiskPath?: string | null;
      preserveSelection?: boolean;
    },
  ) => {
    const seq = ++navigationSeq;
    const client = getIpcClient();
    const { sortBy, sortDir, filterQuery } = get();

    const [breadcrumbs, vizSubtree, childrenPage, artifactGroups, diskOverview] =
      await Promise.all([
        client.getNodeBreadcrumbs(nodeId),
        client.getTreemapSubtree(
          nodeId,
          DEFAULT_SUBTREE_DEPTH,
          DEFAULT_SUBTREE_MAX_CHILDREN,
        ),
        client.getNodeChildren({
          nodeId,
          offset: 0,
          limit: DEFAULT_CHILDREN_LIMIT,
          sortBy,
          sortDir,
          filterQuery: filterQuery.trim() || null,
        }),
        options?.refreshArtifacts
          ? client.getDevArtifacts()
          : Promise.resolve<ArtifactGroupDto[] | null>(null),
        options?.refreshDiskPath !== undefined
          ? client.getDiskOverview(options.refreshDiskPath).catch(() => null)
          : Promise.resolve<DiskOverview | null>(null),
      ]);

    if (seq !== navigationSeq) {
      return;
    }

    set((state) => ({
      currentNodeId: nodeId,
      breadcrumbs,
      vizSubtree,
      childrenPage,
      isLoadingMoreChildren: false,
      hoveredNodeId: null,
      selectedNodeIds: options?.preserveSelection
        ? state.selectedNodeIds
        : new Set<NodeKey>(),
      artifactGroups: artifactGroups ?? state.artifactGroups,
      diskOverview: diskOverview ?? state.diskOverview,
    }));
  };

  return {
    ...createInitialState(),

    bootstrap: async () => {
      const client = getIpcClient();
      const [fdaRes, diskRes] = await Promise.allSettled([
        client.checkFullDiskAccess(),
        client.getDiskOverview(null),
      ]);

      set((state) => ({
        fdaStatus: fdaRes.status === "fulfilled" ? fdaRes.value : state.fdaStatus,
        diskOverview:
          diskRes.status === "fulfilled" ? diskRes.value : state.diskOverview,
      }));
    },

    openFdaSettings: async () => {
      const client = getIpcClient();
      try {
        await client.openFdaSettings();
      } catch (err) {
        const normalized = normalizeIpcError(err);
        set({
          toast: {
            id: nextToastId++,
            tone: "error",
            title: "Unable to open System Settings",
            detail: normalized.message,
          },
        });
      }
    },

    recheckFda: async () => {
      const client = getIpcClient();
      try {
        const fdaStatus = await client.checkFullDiskAccess();
        set({
          fdaStatus,
          fdaBannerDismissed: fdaStatus.granted ? false : get().fdaBannerDismissed,
          toast: fdaStatus.granted
            ? {
                id: nextToastId++,
                tone: "success",
                title: "Full Disk Access granted",
                detail: "Protected macOS folders are now readable for accurate scans.",
              }
            : {
                id: nextToastId++,
                tone: "info",
                title: "Full Disk Access still required",
                detail: `macOS still restricts access to ${fdaStatus.probedPath}.`,
              },
        });
      } catch (err) {
        const normalized = normalizeIpcError(err);
        set({
          toast: {
            id: nextToastId++,
            tone: "error",
            title: "Permission check failed",
            detail: normalized.message,
          },
        });
      }
    },

    dismissFdaBanner: () => {
      set({ fdaBannerDismissed: true });
    },

    scanDirectory: async (path: string) => {
      const client = getIpcClient();
      if (get().scanStatus === "scanning") {
        try {
          await client.cancelScan();
        } catch {
          // Best-effort cancellation before starting a new scan
        }
      }

      set({
        scanStatus: "scanning",
        scanError: null,
        scanProgress: null,
        selectedNodeIds: new Set<NodeKey>(),
        hoveredNodeId: null,
        lastDeleteResult: null,
        filterQuery: "",
      });

      const handleEvent = (event: ScanEvent) => {
        const currentActiveId = get().activeScanId;
        if (
          currentActiveId !== null &&
          event.scanId !== currentActiveId &&
          event.type !== "started"
        ) {
          return;
        }

        switch (event.type) {
          case "started": {
            set({
              scanStatus: "scanning",
              activeScanId: event.scanId,
              scanError: null,
              scanProgress: {
                scanId: event.scanId,
                filesScanned: 0,
                dirsScanned: 0,
                physicalBytes: 0,
                logicalBytes: 0,
                permissionErrors: 0,
                currentPath: event.rootPath,
                elapsedMs: 0,
              },
            });
            break;
          }
          case "progress": {
            set({
              scanProgress: {
                scanId: event.scanId,
                filesScanned: event.filesScanned,
                dirsScanned: event.dirsScanned,
                physicalBytes: event.physicalBytes,
                logicalBytes: event.logicalBytes,
                permissionErrors: event.permissionErrors,
                currentPath: event.currentPath,
                elapsedMs: event.elapsedMs,
              },
            });
            break;
          }
          case "completed": {
            const summary: ScanSummaryState = {
              scanId: event.scanId,
              rootId: event.rootId,
              rootPath: event.rootPath,
              totalFiles: event.totalFiles,
              totalDirs: event.totalDirs,
              totalPhysicalBytes: event.totalPhysicalBytes,
              totalLogicalBytes: event.totalLogicalBytes,
              hardlinkDedupBytes: event.hardlinkDedupBytes,
              permissionErrors: event.permissionErrors,
              durationMs: event.durationMs,
            };

            set({
              scanStatus: "completed",
              activeScanId: null,
              scanProgress: null,
              scanSummary: summary,
              rootNodeId: event.rootId,
              currentNodeId: event.rootId,
            });

            void loadNodeView(event.rootId, {
              refreshArtifacts: true,
              refreshDiskPath: event.rootPath,
              preserveSelection: false,
            }).catch((err) => {
              set({
                scanError: normalizeIpcError(err),
              });
            });
            break;
          }
          case "cancelled": {
            set({
              scanStatus: "cancelled",
              activeScanId: null,
              scanProgress: null,
            });
            break;
          }
          case "error": {
            set({
              scanStatus: "error",
              activeScanId: null,
              scanProgress: null,
              scanError: {
                code: event.code,
                message: event.message,
              },
            });
            break;
          }
        }
      };

      try {
        const scanId = await client.startScan(path, handleEvent);
        if (get().scanStatus === "scanning" && get().activeScanId === null) {
          set({ activeScanId: scanId });
        }
      } catch (err) {
        const normalized = normalizeIpcError(err);
        set({
          scanStatus: "error",
          activeScanId: null,
          scanProgress: null,
          scanError: normalized,
        });
      }
    },

    pickAndScan: async () => {
      const client = getIpcClient();
      try {
        const picked = await client.pickScanDirectory();
        if (picked) {
          await get().scanDirectory(picked);
        }
      } catch (err) {
        const normalized = normalizeIpcError(err);
        set({
          toast: {
            id: nextToastId++,
            tone: "error",
            title: "Could not open folder picker",
            detail: normalized.message,
          },
        });
      }
    },

    cancelScan: async () => {
      const client = getIpcClient();
      try {
        await client.cancelScan();
      } catch (err) {
        const normalized = normalizeIpcError(err);
        set({
          toast: {
            id: nextToastId++,
            tone: "error",
            title: "Failed to cancel scan",
            detail: normalized.message,
          },
        });
      }
    },

    drillDown: async (nodeId: NodeKey) => {
      const { childrenPage, vizSubtree } = get();

      // Guard: if the clicked node is known to be a regular file, select it rather than drilling in
      const listMatch = childrenPage?.items.find((item) => item.id === nodeId);
      if (listMatch && !listMatch.isDir) {
        set({ selectedNodeIds: new Set<NodeKey>([nodeId]) });
        return;
      }
      const treeMatch = findNodeInSubtree(vizSubtree, nodeId);
      if (treeMatch && !treeMatch.isDir) {
        set({ selectedNodeIds: new Set<NodeKey>([nodeId]) });
        return;
      }

      try {
        // Clear directory search filter when moving into a different directory
        if (get().filterQuery !== "") {
          set({ filterQuery: "" });
        }
        await loadNodeView(nodeId, { preserveSelection: false });
      } catch (err) {
        const normalized = normalizeIpcError(err);
        set({
          toast: {
            id: nextToastId++,
            tone: "error",
            title: "Unable to open folder",
            detail: normalized.message,
          },
        });
      }
    },

    navigateBreadcrumb: async (nodeId: NodeKey) => {
      await get().drillDown(nodeId);
    },

    loadMoreChildren: async () => {
      const {
        currentNodeId,
        childrenPage,
        isLoadingMoreChildren,
        sortBy,
        sortDir,
        filterQuery,
      } = get();

      if (
        !currentNodeId ||
        !childrenPage ||
        !childrenPage.hasMore ||
        isLoadingMoreChildren
      ) {
        return;
      }

      set({ isLoadingMoreChildren: true });
      const client = getIpcClient();
      try {
        const nextOffset = childrenPage.items.length;
        const page = await client.getNodeChildren({
          nodeId: currentNodeId,
          offset: nextOffset,
          limit: DEFAULT_CHILDREN_LIMIT,
          sortBy,
          sortDir,
          filterQuery: filterQuery.trim() || null,
        });

        // Ensure we are still viewing the same directory
        if (get().currentNodeId !== currentNodeId) {
          set({ isLoadingMoreChildren: false });
          return;
        }

        const existingIds = new Set(childrenPage.items.map((item) => item.id));
        const appended = page.items.filter((item) => !existingIds.has(item.id));
        set({
          childrenPage: {
            ...page,
            offset: 0,
            items: [...childrenPage.items, ...appended],
          },
          isLoadingMoreChildren: false,
        });
      } catch {
        set({ isLoadingMoreChildren: false });
      }
    },

    setSort: async (field: SortField) => {
      const { sortBy, sortDir, currentNodeId, filterQuery } = get();
      let nextDir: SortDirection;
      if (field === sortBy) {
        nextDir = sortDir === "desc" ? "asc" : "desc";
      } else {
        nextDir = field === "name" ? "asc" : "desc";
      }

      set({ sortBy: field, sortDir: nextDir });

      if (!currentNodeId) return;
      const client = getIpcClient();
      try {
        const childrenPage = await client.getNodeChildren({
          nodeId: currentNodeId,
          offset: 0,
          limit: DEFAULT_CHILDREN_LIMIT,
          sortBy: field,
          sortDir: nextDir,
          filterQuery: filterQuery.trim() || null,
        });
        if (get().currentNodeId === currentNodeId) {
          set({ childrenPage });
        }
      } catch (err) {
        const normalized = normalizeIpcError(err);
        set({
          toast: {
            id: nextToastId++,
            tone: "error",
            title: "Failed to sort folder contents",
            detail: normalized.message,
          },
        });
      }
    },

    setFilterQuery: async (q: string) => {
      set({ filterQuery: q });
      const { currentNodeId, sortBy, sortDir } = get();
      if (!currentNodeId) return;

      const client = getIpcClient();
      try {
        const childrenPage = await client.getNodeChildren({
          nodeId: currentNodeId,
          offset: 0,
          limit: DEFAULT_CHILDREN_LIMIT,
          sortBy,
          sortDir,
          filterQuery: q.trim() || null,
        });
        if (get().currentNodeId === currentNodeId && get().filterQuery === q) {
          set({ childrenPage });
        }
      } catch (err) {
        const normalized = normalizeIpcError(err);
        set({
          toast: {
            id: nextToastId++,
            tone: "error",
            title: "Filter query failed",
            detail: normalized.message,
          },
        });
      }
    },

    toggleSelectNode: (id: NodeKey) => {
      set((state) => {
        const next = new Set(state.selectedNodeIds);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return { selectedNodeIds: next };
      });
    },

    selectNodes: (ids: NodeKey[]) => {
      set({ selectedNodeIds: new Set<NodeKey>(ids) });
    },

    clearSelection: () => {
      set({ selectedNodeIds: new Set<NodeKey>() });
    },

    setHoveredNode: (id: NodeKey | null) => {
      if (get().hoveredNodeId === id) return;
      set({ hoveredNodeId: id });
    },

    setVizMode: (mode: VizMode) => {
      set({ vizMode: mode });
    },

    setActiveTab: (tab: ActiveTab) => {
      set({ activeTab: tab });
    },

    openDeleteModal: (targets: NodeSummaryDto[]) => {
      if (targets.length === 0) return;
      set({
        pendingDeleteTargets: targets,
        deleteModalOpen: true,
        lastDeleteResult: null,
      });
    },

    closeDeleteModal: () => {
      if (get().isDeleting) return;
      set({
        deleteModalOpen: false,
        pendingDeleteTargets: [],
      });
    },

    confirmDelete: async (mode: DeleteMode) => {
      const {
        pendingDeleteTargets,
        currentNodeId,
        rootNodeId,
        breadcrumbs,
        scanSummary,
        hoveredNodeId,
      } = get();

      if (pendingDeleteTargets.length === 0) {
        return null;
      }

      set({ isDeleting: true });
      const client = getIpcClient();
      const nodeIds = pendingDeleteTargets.map((target) => target.id);

      try {
        const result = await client.deleteNodes({ nodeIds, mode });
        const deletedSet = new Set<NodeKey>(result.deletedNodeIds);

        // Remove deleted items from selection and hover state
        const remainingSelection = new Set<NodeKey>();
        for (const id of get().selectedNodeIds) {
          if (!deletedSet.has(id)) {
            remainingSelection.add(id);
          }
        }

        // Update summary totals instantaneously from arena's updatedRoot
        const updatedSummary =
          scanSummary && result.updatedRoot
            ? {
                ...scanSummary,
                totalFiles: result.updatedRoot.fileCount,
                totalDirs: result.updatedRoot.dirCount + 1,
                totalPhysicalBytes: result.updatedRoot.physicalBytes,
                totalLogicalBytes: result.updatedRoot.logicalBytes,
              }
            : scanSummary;

        set({
          isDeleting: false,
          lastDeleteResult: result,
          selectedNodeIds: remainingSelection,
          hoveredNodeId:
            hoveredNodeId && deletedSet.has(hoveredNodeId)
              ? null
              : hoveredNodeId,
          scanSummary: updatedSummary,
        });

        // Pick a surviving node to refresh from the updated arena (NO rescan!)
        let targetRefreshNodeId: NodeKey | null = currentNodeId;
        if (targetRefreshNodeId && deletedSet.has(targetRefreshNodeId)) {
          const survivingCrumb = [...breadcrumbs]
            .reverse()
            .find((crumb) => !deletedSet.has(crumb.id));
          targetRefreshNodeId = survivingCrumb?.id ?? rootNodeId;
        }

        if (targetRefreshNodeId) {
          try {
            await loadNodeView(targetRefreshNodeId, {
              refreshArtifacts: true,
              refreshDiskPath: updatedSummary?.rootPath ?? null,
              preserveSelection: true,
            });
          } catch {
            // If current node was indirectly removed because an ancestor was deleted,
            // fall back cleanly to the scan root.
            if (rootNodeId && rootNodeId !== targetRefreshNodeId) {
              await loadNodeView(rootNodeId, {
                refreshArtifacts: true,
                refreshDiskPath: updatedSummary?.rootPath ?? null,
                preserveSelection: true,
              });
            }
          }
        }

        const deletedCount = result.deletedNodeIds.length;
        const reclaimedLabel = formatBytes(result.reclaimedPhysicalBytes);

        if (result.failures.length === 0) {
          set({
            deleteModalOpen: false,
            pendingDeleteTargets: [],
            toast: {
              id: nextToastId++,
              tone: "success",
              title:
                mode === "trash"
                  ? `Moved ${deletedCount} ${deletedCount === 1 ? "item" : "items"} to Trash`
                  : `Permanently deleted ${deletedCount} ${deletedCount === 1 ? "item" : "items"}`,
              detail: `Reclaimed ${reclaimedLabel} of physical disk space.`,
            },
          });
        } else {
          // Keep modal open so ProtectedPathGuard / I/O failures are clearly visible,
          // and prune any already-deleted targets so retrying only targets failed items.
          const remainingTargets = get().pendingDeleteTargets.filter(
            (target) => !deletedSet.has(target.id),
          );
          set({
            pendingDeleteTargets: remainingTargets,
            toast: {
              id: nextToastId++,
              tone: deletedCount > 0 ? "warning" : "error",
              title:
                deletedCount > 0
                  ? `Cleaned ${deletedCount} ${deletedCount === 1 ? "item" : "items"}, ${result.failures.length} skipped`
                  : `Cleanup blocked for ${result.failures.length} ${result.failures.length === 1 ? "item" : "items"}`,
              detail:
                deletedCount > 0
                  ? `Reclaimed ${reclaimedLabel}. Review skipped items in the dialog.`
                  : result.failures[0]?.reason,
            },
          });
        }

        return result;
      } catch (err) {
        const normalized = normalizeIpcError(err);
        set({
          isDeleting: false,
          toast: {
            id: nextToastId++,
            tone: "error",
            title: "Cleanup failed",
            detail: normalized.message,
          },
        });
        return null;
      }
    },

    revealInFinder: async (nodeId: NodeKey) => {
      const client = getIpcClient();
      try {
        await client.revealInFinder(nodeId);
      } catch (err) {
        const normalized = normalizeIpcError(err);
        set({
          toast: {
            id: nextToastId++,
            tone: "error",
            title: "Unable to reveal in Finder",
            detail: normalized.message,
          },
        });
      }
    },

    dismissToast: () => {
      set({ toast: null });
    },

    resetStore: () => {
      navigationSeq += 1;
      set(createInitialState());
    },
  };
});
