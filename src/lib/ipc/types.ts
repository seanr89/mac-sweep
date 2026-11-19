/**
 * Canonical TypeScript IPC contract for Mac Sweep.
 *
 * MUST stay 100% synchronized with:
 * - `src-tauri/src/ipc/types.rs`
 * - `docs/ipc-contract.md`
 */

/**
 * Decimal-stringified `u64` representation of a `slotmap::KeyData` FFI key.
 * Serialized as a string to prevent IEEE-754 53-bit precision loss in JS.
 */
export type NodeKey = string;

/** Active Canvas visualization mode. */
export type VizMode = "treemap" | "sunburst";

/** Status of macOS Full Disk Access (TCC) permission probe. */
export interface FdaStatus {
  granted: boolean;
  probedPath: string;
  settingsUrl: string;
}

/** Capacity metrics for a mounted APFS/POSIX volume. */
export interface DiskOverview {
  mountPoint: string;
  volumeName: string;
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  purgeableBytes: number | null;
}

/** Streaming scan lifecycle events emitted over Tauri v2 `Channel<ScanEvent>`. */
export type ScanEvent =
  | {
      type: "started";
      scanId: number;
      rootPath: string;
    }
  | {
      type: "progress";
      scanId: number;
      filesScanned: number;
      dirsScanned: number;
      physicalBytes: number;
      logicalBytes: number;
      permissionErrors: number;
      currentPath: string;
      elapsedMs: number;
    }
  | {
      type: "completed";
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
  | {
      type: "cancelled";
      scanId: number;
      filesScanned: number;
      elapsedMs: number;
    }
  | {
      type: "error";
      scanId: number;
      code: string;
      message: string;
    };

/** High-level visual and semantic classification for files and directories. */
export type FileCategory =
  | "directory"
  | "code"
  | "media"
  | "archive"
  | "diskImage"
  | "document"
  | "system"
  | "other";

/** Detailed summary of a single filesystem node for list/inspector views. */
export interface NodeSummaryDto {
  id: NodeKey;
  parentId: NodeKey | null;
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  isHardlinkDup: boolean;
  permissionDenied: boolean;
  physicalBytes: number;
  logicalBytes: number;
  fileCount: number;
  dirCount: number;
  modifiedSecs: number | null;
  category: FileCategory;
  percentOfParent: number;
}

/** Compact recursive subtree DTO tailored for 60fps HTML5 Canvas visualizations. */
export interface SubtreeNodeDto {
  id: NodeKey;
  name: string;
  path: string;
  isDir: boolean;
  isHardlinkDup: boolean;
  physicalBytes: number;
  logicalBytes: number;
  fileCount: number;
  category: FileCategory;
  children: SubtreeNodeDto[];
  hasMoreChildren: boolean;
  aggregatedOtherBytes: number;
}

/** Sort key for paginated directory children queries. */
export type SortField =
  | "physicalBytes"
  | "logicalBytes"
  | "name"
  | "fileCount"
  | "modifiedSecs";

/** Sort ordering direction. */
export type SortDirection = "asc" | "desc";

/** Paginated slice of a directory's direct children. */
export interface NodeChildrenPage {
  parent: NodeSummaryDto;
  items: NodeSummaryDto[];
  totalCount: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

/** Ancestor trail segment from the active scan root to the focused node. */
export interface BreadcrumbDto {
  id: NodeKey;
  name: string;
  path: string;
  physicalBytes: number;
}

/** Risk level annotation for detected developer/system cleanup artifacts. */
export type ArtifactRiskLevel = "safe" | "caution";

/** A single detected reclaimable artifact matching a preset rule. */
export interface ArtifactMatchDto {
  nodeId: NodeKey;
  groupId: string;
  name: string;
  path: string;
  projectName: string | null;
  physicalBytes: number;
  logicalBytes: number;
  fileCount: number;
  modifiedSecs: number | null;
  risk: ArtifactRiskLevel;
}

/** Aggregated group of detected reclaimable developer artifacts. */
export interface ArtifactGroupDto {
  id: string;
  label: string;
  description: string;
  risk: ArtifactRiskLevel;
  totalPhysicalBytes: number;
  totalFileCount: number;
  itemCount: number;
  items: ArtifactMatchDto[];
}

/** Deletion strategy. Always defaults to `"trash"` in UI and backend flows. */
export type DeleteMode = "trash" | "permanent";

/** Request payload for `delete_nodes`. */
export interface DeleteRequest {
  nodeIds: NodeKey[];
  mode: DeleteMode;
}

/** Per-item error entry when partial deletion occurs. */
export interface DeleteFailure {
  nodeId: NodeKey;
  path: string;
  code: string;
  reason: string;
}

/** Result returned by `delete_nodes` after filesystem removal and arena update. */
export interface DeleteResult {
  deletedNodeIds: NodeKey[];
  reclaimedPhysicalBytes: number;
  reclaimedLogicalBytes: number;
  failures: DeleteFailure[];
  updatedRoot: NodeSummaryDto | null;
}

/** Structured error payload serialized by Rust `AppError`. */
export interface AppErrorPayload {
  code: string;
  message: string;
}
