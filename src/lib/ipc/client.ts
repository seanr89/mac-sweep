import { Channel, invoke } from "@tauri-apps/api/core";
import {
  createMockScanStore,
  MOCK_DISK_OVERVIEW,
  MOCK_FDA_STATUS,
  type MockScanStore,
} from "./mockData";
import type {
  AppErrorPayload,
  ArtifactGroupDto,
  BreadcrumbDto,
  DeleteRequest,
  DeleteResult,
  DiskOverview,
  FdaStatus,
  NodeChildrenPage,
  NodeKey,
  ScanEvent,
  SortDirection,
  SortField,
  SubtreeNodeDto,
} from "./types";

export interface GetNodeChildrenParams {
  nodeId: NodeKey;
  offset: number;
  limit: number;
  sortBy: SortField;
  sortDir: SortDirection;
  filterQuery?: string | null;
}

/**
 * Dual-mode IPC client contract covering all 12 commands in `docs/ipc-contract.md`.
 */
export interface SweepIpcClient {
  checkFullDiskAccess(): Promise<FdaStatus>;
  openFdaSettings(): Promise<void>;
  getDiskOverview(path?: string | null): Promise<DiskOverview>;
  pickScanDirectory(): Promise<string | null>;
  startScan(
    path: string,
    onEvent: (event: ScanEvent) => void,
  ): Promise<number>;
  cancelScan(): Promise<boolean>;
  getNodeChildren(params: GetNodeChildrenParams): Promise<NodeChildrenPage>;
  getTreemapSubtree(
    nodeId: NodeKey,
    maxDepth?: number,
    maxChildren?: number,
  ): Promise<SubtreeNodeDto>;
  getNodeBreadcrumbs(nodeId: NodeKey): Promise<BreadcrumbDto[]>;
  getDevArtifacts(): Promise<ArtifactGroupDto[]>;
  deleteNodes(request: DeleteRequest): Promise<DeleteResult>;
  revealInFinder(nodeId: NodeKey): Promise<void>;
}

/**
 * Normalize unknown Rust/Tauri or mock IPC errors into a consistent `AppErrorPayload`.
 */
export function normalizeIpcError(err: unknown): AppErrorPayload {
  if (typeof err === "object" && err !== null) {
    const record = err as Record<string, unknown>;
    if (
      typeof record.code === "string" &&
      typeof record.message === "string"
    ) {
      return { code: record.code, message: record.message };
    }
    if (err instanceof Error) {
      return { code: "INTERNAL_ERROR", message: err.message };
    }
  }
  if (typeof err === "string") {
    return { code: "INTERNAL_ERROR", message: err };
  }
  return {
    code: "INTERNAL_ERROR",
    message: "An unexpected IPC error occurred.",
  };
}

/**
 * Returns `true` when running inside a live Tauri v2 desktop webview.
 */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Live Tauri v2 IPC client delegating to Rust `#[tauri::command]` handlers.
 */
export class TauriIpcClient implements SweepIpcClient {
  async checkFullDiskAccess(): Promise<FdaStatus> {
    return invoke<FdaStatus>("check_full_disk_access");
  }

  async openFdaSettings(): Promise<void> {
    return invoke<void>("open_fda_settings");
  }

  async getDiskOverview(path?: string | null): Promise<DiskOverview> {
    return invoke<DiskOverview>("get_disk_overview", {
      path: path ?? null,
    });
  }

  async pickScanDirectory(): Promise<string | null> {
    return invoke<string | null>("pick_scan_directory");
  }

  async startScan(
    path: string,
    onEvent: (event: ScanEvent) => void,
  ): Promise<number> {
    const channel = new Channel<ScanEvent>();
    channel.onmessage = (event) => {
      onEvent(event);
    };
    return invoke<number>("start_scan", {
      path,
      onEvent: channel,
    });
  }

  async cancelScan(): Promise<boolean> {
    return invoke<boolean>("cancel_scan");
  }

  async getNodeChildren(
    params: GetNodeChildrenParams,
  ): Promise<NodeChildrenPage> {
    return invoke<NodeChildrenPage>("get_node_children", {
      nodeId: params.nodeId,
      offset: params.offset,
      limit: params.limit,
      sortBy: params.sortBy,
      sortDir: params.sortDir,
      filterQuery: params.filterQuery ?? null,
    });
  }

  async getTreemapSubtree(
    nodeId: NodeKey,
    maxDepth = 4,
    maxChildren = 40,
  ): Promise<SubtreeNodeDto> {
    return invoke<SubtreeNodeDto>("get_treemap_subtree", {
      nodeId,
      maxDepth,
      maxChildren,
    });
  }

  async getNodeBreadcrumbs(nodeId: NodeKey): Promise<BreadcrumbDto[]> {
    return invoke<BreadcrumbDto[]>("get_node_breadcrumbs", {
      nodeId,
    });
  }

  async getDevArtifacts(): Promise<ArtifactGroupDto[]> {
    return invoke<ArtifactGroupDto[]>("get_dev_artifacts");
  }

  async deleteNodes(request: DeleteRequest): Promise<DeleteResult> {
    return invoke<DeleteResult>("delete_nodes", {
      request,
    });
  }

  async revealInFinder(nodeId: NodeKey): Promise<void> {
    return invoke<void>("reveal_in_finder", {
      nodeId,
    });
  }
}

export interface MockIpcClientOptions {
  /** Delay between simulated scan progress ticks in ms (default: 40ms). */
  stepDelayMs?: number;
  /** Initial Full Disk Access status (default: false so FDA banner is exercisable). */
  initialFdaGranted?: boolean;
  /** Default directory returned by `pickScanDirectory()` (default: "/Users/alex"). */
  defaultPickedPath?: string;
}

/**
 * Deterministic in-memory mock IPC client backed by `createMockScanStore()` for
 * standalone Vite browser preview and Vitest test suites.
 */
export class MockIpcClient implements SweepIpcClient {
  private store: MockScanStore | null = null;
  private fdaStatus: FdaStatus;
  private fdaSettingsOpened = false;
  private diskOverview: DiskOverview;
  private nextScanId = 1;
  private activeScanId: number | null = null;
  private activeCancelFlag = false;
  private activeTimers: ReturnType<typeof setTimeout>[] = [];
  private readonly stepDelayMs: number;
  private readonly defaultPickedPath: string;
  public readonly revealedNodeIds: NodeKey[] = [];

  constructor(options: MockIpcClientOptions = {}) {
    this.stepDelayMs = options.stepDelayMs ?? 40;
    this.defaultPickedPath = options.defaultPickedPath ?? "/Users/alex";
    this.fdaStatus = {
      ...MOCK_FDA_STATUS,
      granted: options.initialFdaGranted ?? MOCK_FDA_STATUS.granted,
    };
    this.diskOverview = { ...MOCK_DISK_OVERVIEW };
  }

  /** Test helper to toggle FDA status deterministically in mock mode. */
  setMockFdaGranted(granted: boolean): void {
    this.fdaStatus = { ...this.fdaStatus, granted };
  }

  private requireStore(): MockScanStore {
    if (!this.store) {
      throw {
        code: "NO_ACTIVE_SCAN",
        message: "No active scan available. Start a scan first.",
      } satisfies AppErrorPayload;
    }
    return this.store;
  }

  private clearActiveTimers(): void {
    for (const timer of this.activeTimers) {
      clearTimeout(timer);
    }
    this.activeTimers = [];
  }

  private resolveMockPath(rawPath: string): string {
    const trimmed = rawPath.trim();
    if (trimmed === "~" || trimmed === "") {
      return "/Users/alex";
    }
    if (trimmed.startsWith("~/")) {
      return `/Users/alex/${trimmed.slice(2)}`;
    }
    return trimmed;
  }

  async checkFullDiskAccess(): Promise<FdaStatus> {
    // In browser preview, once the user clicked "Grant Full Disk Access",
    // clicking "Re-check" simulates the macOS TCC grant taking effect.
    if (this.fdaSettingsOpened && !this.fdaStatus.granted) {
      this.fdaStatus = { ...this.fdaStatus, granted: true };
    }
    return { ...this.fdaStatus };
  }

  async openFdaSettings(): Promise<void> {
    this.fdaSettingsOpened = true;
  }

  async getDiskOverview(path?: string | null): Promise<DiskOverview> {
    if (path && path.startsWith("/Volumes/")) {
      const volumeSegment = path.split("/").filter(Boolean)[1] ?? "External SSD";
      return {
        ...this.diskOverview,
        mountPoint: `/Volumes/${volumeSegment}`,
        volumeName: volumeSegment,
      };
    }
    return { ...this.diskOverview };
  }

  async pickScanDirectory(): Promise<string | null> {
    return this.defaultPickedPath;
  }

  async startScan(
    path: string,
    onEvent: (event: ScanEvent) => void,
  ): Promise<number> {
    if (this.activeScanId !== null) {
      throw {
        code: "SCAN_IN_PROGRESS",
        message: "A scan is already running.",
      } satisfies AppErrorPayload;
    }

    const resolvedPath = this.resolveMockPath(path);
    const scanId = this.nextScanId++;
    this.activeScanId = scanId;
    this.activeCancelFlag = false;
    this.clearActiveTimers();

    const nextStore = createMockScanStore(resolvedPath);
    const totals = nextStore.getScanTotals();

    const startedAt = Date.now();
    onEvent({
      type: "started",
      scanId,
      rootPath: nextStore.rootPath,
    });

    const progressSteps = [
      {
        ratio: 0.28,
        currentPath: `${nextStore.rootPath}/Library/Developer/Xcode/DerivedData`,
      },
      {
        ratio: 0.64,
        currentPath: `${nextStore.rootPath}/Projects/mac-sweep/target`,
      },
      {
        ratio: 0.92,
        currentPath: `${nextStore.rootPath}/Movies/4K-Drone-Coastline.mov`,
      },
    ];

    const scheduleStep = (stepIndex: number) => {
      const timer = setTimeout(() => {
        if (this.activeScanId !== scanId) {
          return;
        }

        const elapsedMs = Math.max(12, Date.now() - startedAt);
        if (this.activeCancelFlag) {
          const prevRatio =
            stepIndex > 0 ? (progressSteps[stepIndex - 1]?.ratio ?? 0.2) : 0.1;
          this.activeScanId = null;
          this.activeCancelFlag = false;
          this.clearActiveTimers();
          onEvent({
            type: "cancelled",
            scanId,
            filesScanned: Math.round(totals.totalFiles * prevRatio),
            elapsedMs,
          });
          return;
        }

        const step = progressSteps[stepIndex];
        if (step) {
          onEvent({
            type: "progress",
            scanId,
            filesScanned: Math.round(totals.totalFiles * step.ratio),
            dirsScanned: Math.round(totals.totalDirs * step.ratio),
            physicalBytes: Math.round(totals.totalPhysicalBytes * step.ratio),
            logicalBytes: Math.round(totals.totalLogicalBytes * step.ratio),
            permissionErrors:
              stepIndex >= 1 ? totals.permissionErrors : 0,
            currentPath: step.currentPath,
            elapsedMs,
          });
          scheduleStep(stepIndex + 1);
          return;
        }

        // Terminal completion
        this.store = nextStore;
        this.activeScanId = null;
        this.clearActiveTimers();
        onEvent({
          type: "completed",
          scanId,
          rootId: nextStore.rootId,
          rootPath: nextStore.rootPath,
          totalFiles: totals.totalFiles,
          totalDirs: totals.totalDirs,
          totalPhysicalBytes: totals.totalPhysicalBytes,
          totalLogicalBytes: totals.totalLogicalBytes,
          hardlinkDedupBytes: totals.hardlinkDedupBytes,
          permissionErrors: totals.permissionErrors,
          durationMs: Math.max(85, elapsedMs),
        });
      }, this.stepDelayMs);

      this.activeTimers.push(timer);
    };

    scheduleStep(0);
    return scanId;
  }

  async cancelScan(): Promise<boolean> {
    if (this.activeScanId === null) {
      return false;
    }
    this.activeCancelFlag = true;
    return true;
  }

  async getNodeChildren(
    params: GetNodeChildrenParams,
  ): Promise<NodeChildrenPage> {
    const store = this.requireStore();
    return store.getNodeChildren(
      params.nodeId,
      params.offset,
      params.limit,
      params.sortBy,
      params.sortDir,
      params.filterQuery,
    );
  }

  async getTreemapSubtree(
    nodeId: NodeKey,
    maxDepth = 4,
    maxChildren = 40,
  ): Promise<SubtreeNodeDto> {
    const store = this.requireStore();
    return store.getTreemapSubtree(nodeId, maxDepth, maxChildren);
  }

  async getNodeBreadcrumbs(nodeId: NodeKey): Promise<BreadcrumbDto[]> {
    const store = this.requireStore();
    return store.getNodeBreadcrumbs(nodeId);
  }

  async getDevArtifacts(): Promise<ArtifactGroupDto[]> {
    const store = this.requireStore();
    return store.getDevArtifacts();
  }

  async deleteNodes(request: DeleteRequest): Promise<DeleteResult> {
    const store = this.requireStore();
    const result = store.deleteNodes(request);
    if (result.reclaimedPhysicalBytes > 0) {
      this.diskOverview = {
        ...this.diskOverview,
        usedBytes: Math.max(
          0,
          this.diskOverview.usedBytes - result.reclaimedPhysicalBytes,
        ),
        availableBytes: Math.min(
          this.diskOverview.totalBytes,
          this.diskOverview.availableBytes + result.reclaimedPhysicalBytes,
        ),
      };
    }
    return result;
  }

  async revealInFinder(nodeId: NodeKey): Promise<void> {
    const store = this.requireStore();
    const node = store.getNode(nodeId);
    if (!node) {
      throw {
        code: "NODE_NOT_FOUND",
        message: `Node not found: ${nodeId}`,
      } satisfies AppErrorPayload;
    }
    this.revealedNodeIds.push(nodeId);
  }
}

let activeClient: SweepIpcClient | null = null;

/**
 * Retrieve the active IPC client singleton. Automatically selects `TauriIpcClient`
 * when running inside Tauri v2 and `MockIpcClient` in standalone Vite/Vitest.
 */
export function getIpcClient(): SweepIpcClient {
  if (!activeClient) {
    activeClient = isTauriRuntime()
      ? new TauriIpcClient()
      : new MockIpcClient();
  }
  return activeClient;
}

/**
 * Test injection hook to override or reset (`null`) the active IPC client.
 */
export function setIpcClient(client: SweepIpcClient | null): void {
  activeClient = client;
}
