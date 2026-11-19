# Mac Sweep IPC Contract Specification

This document is the canonical Rust ↔ TypeScript IPC specification for **Mac Sweep** (`dev.macsweep.desktop`).

The following three files MUST remain 100% synchronized at all times:
1. `docs/ipc-contract.md` (this specification)
2. `src-tauri/src/ipc/types.rs` (Rust `serde` DTOs & `AppError`)
3. `src/lib/ipc/types.ts` (TypeScript strict interfaces & union types)

---

## 1. Fundamental Encoding Rules

### 1.1 `NodeKey` (Precision-Safe `SlotMap` Handle)
`SlotMap`'s `KeyData::as_ffi()` returns a `u64` whose upper 32 bits carry the generation version. Serializing a `u64` as a JSON number loses precision in JavaScript (`Number.MAX_SAFE_INTEGER` is $2^{53} - 1$).

- **Rule:** Every `NodeId` crosses the JSON IPC boundary as a base-10 string:
  - Rust: `pub type NodeKey = String;` (helpers `node_id_to_key` / `key_to_node_id` in `src-tauri/src/ipc/types.rs`)
  - TypeScript: `export type NodeKey = string;`

### 1.2 Case Convention
- All Rust DTO structs and enum variants use `#[serde(rename_all = "camelCase")]`.
- Tagged enums with struct fields (`ScanEvent`) use `#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]`.
- Tauri v2 automatically converts Rust `#[tauri::command]` parameter names from `snake_case` to `camelCase` in JavaScript `invoke(command, args)`.

### 1.3 Physical vs. Logical Bytes
- `physicalBytes` (`metadata.blocks().saturating_mul(512)`) is ALWAYS the primary storage metric across all DTOs, layouts, and sorting defaults.
- `logicalBytes` (`metadata.size()`) is exposed as secondary metadata so sparse files (e.g., Docker `.raw` disk images) are clearly identified without inflating actual disk usage.
- Hard-link duplicates (`nlink > 1` on subsequent encounters of `(dev, ino)`) set `isHardlinkDup = true` and `physicalBytes = 0`.

---

## 2. Error Shape (`AppError` / `AppErrorPayload`)

All Tauri commands return `Result<T, AppError>`. Rust `AppError` implements `serde::Serialize` to produce a consistent JSON object:

```json
{
  "code": "PROTECTED_PATH",
  "message": "Refusing to modify protected path: /System"
}
```

### Standard Error Codes
| Code | Rust Variant | Description |
| :--- | :--- | :--- |
| `NO_ACTIVE_SCAN` | `AppError::NoActiveScan` | Query or cleanup attempted before a scan completed. |
| `SCAN_IN_PROGRESS` | `AppError::ScanInProgress` | `start_scan` called while another scan is active. |
| `INVALID_NODE_KEY` | `AppError::InvalidNodeKey(String)` | Malformed non-`u64` decimal `NodeKey`. |
| `NODE_NOT_FOUND` | `AppError::NodeNotFound(String)` | `NodeKey` no longer exists in the `SlotMap` arena (e.g., already deleted or stale generation). |
| `PROTECTED_PATH` | `AppError::ProtectedPath(String)` | Blocked by `ProtectedPathGuard` (`/`, `/System`, `/Applications`, `$HOME`, etc.). |
| `PATH_OUTSIDE_SCAN_ROOT` | `AppError::PathOutsideScanRoot(String)` | Target path escapes the active scan root. |
| `INVALID_PATH` | `AppError::InvalidPath(String)` | Path does not exist or is not readable/valid. |
| `PERMISSION_DENIED` | `AppError::PermissionDenied(String)` | macOS TCC / POSIX `EPERM` or `EACCES`. |
| `TRASH_FAILED` | `AppError::TrashFailed(String)` | `trash::delete` (`NSFileManager.trashItemAtURL`) failed. |
| `IO_ERROR` | `AppError::Io(String)` | Underlying filesystem I/O failure. |
| `INTERNAL_ERROR` | `AppError::Internal(String)` | Unexpected internal state or platform call error. |

---

## 3. Streaming Protocol (`Channel<ScanEvent>`)

`start_scan` accepts a Tauri v2 `Channel<ScanEvent>` (`onEvent` on JS side).

- **Throttling invariant:** `ScanEvent::Progress` MUST be throttled to at most once every **50–100ms** (target 75ms). Never emit per-file IPC events.
- **Lifecycle:**
  1. `started` — emitted once immediately when traversal begins.
  2. `progress` — emitted periodically while traversing and rolling up arena totals.
  3. Exactly one terminal event: `completed`, `cancelled`, or `error`.

### `ScanEvent` Discriminated Union (`tag = "type"`)

```ts
export type ScanEvent =
  | { type: "started"; scanId: number; rootPath: string }
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
  | { type: "cancelled"; scanId: number; filesScanned: number; elapsedMs: number }
  | { type: "error"; scanId: number; code: string; message: string };
```

---

## 4. Shared DTO Reference

### `FdaStatus`
```ts
export interface FdaStatus {
  granted: boolean;
  probedPath: string;
  settingsUrl: string;
}
```

### `DiskOverview`
```ts
export interface DiskOverview {
  mountPoint: string;
  volumeName: string;
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  purgeableBytes: number | null;
}
```

### `FileCategory`
`"directory" | "code" | "media" | "archive" | "diskImage" | "document" | "system" | "other"`

### `NodeSummaryDto`
```ts
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
```

### `SubtreeNodeDto`
```ts
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
```

### `SortField` & `SortDirection`
- `SortField`: `"physicalBytes" | "logicalBytes" | "name" | "fileCount" | "modifiedSecs"`
- `SortDirection`: `"asc" | "desc"`

### `NodeChildrenPage`
```ts
export interface NodeChildrenPage {
  parent: NodeSummaryDto;
  items: NodeSummaryDto[];
  totalCount: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}
```

### `BreadcrumbDto`
```ts
export interface BreadcrumbDto {
  id: NodeKey;
  name: string;
  path: string;
  physicalBytes: number;
}
```

### `ArtifactRiskLevel`, `ArtifactMatchDto`, `ArtifactGroupDto`
```ts
export type ArtifactRiskLevel = "safe" | "caution";

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
```

### `DeleteMode`, `DeleteRequest`, `DeleteFailure`, `DeleteResult`
```ts
export type DeleteMode = "trash" | "permanent";

export interface DeleteRequest {
  nodeIds: NodeKey[];
  mode: DeleteMode;
}

export interface DeleteFailure {
  nodeId: NodeKey;
  path: string;
  code: string;
  reason: string;
}

export interface DeleteResult {
  deletedNodeIds: NodeKey[];
  reclaimedPhysicalBytes: number;
  reclaimedLogicalBytes: number;
  failures: DeleteFailure[];
  updatedRoot: NodeSummaryDto | null;
}
```

---

## 5. Tauri Commands (12 Registered Handlers)

| # | Command | JS `invoke` Args | Return Type | Notes |
| :- | :--- | :--- | :--- | :--- |
| 1 | `check_full_disk_access` | *(none)* | `FdaStatus` | Non-blocking TCC probe (`~/Library/Safari`, fallback `~/Library/Mail`). |
| 2 | `open_fda_settings` | *(none)* | `void` | Opens `x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles`. |
| 3 | `get_disk_overview` | `{ path?: string \| null }` | `DiskOverview` | Calls `statvfs` on the target path (defaults to `/`). |
| 4 | `pick_scan_directory` | *(none)* | `string \| null` | Opens native macOS folder picker via `tauri-plugin-dialog`. |
| 5 | `start_scan` | `{ path: string, onEvent: Channel<ScanEvent> }` | `number` (`scanId`) | Starts background parallel APFS scan and streams `ScanEvent`s over `onEvent`. |
| 6 | `cancel_scan` | *(none)* | `boolean` | Signals the active scan's `AtomicBool` cancel flag; returns `true` if a scan was active. |
| 7 | `get_node_children` | `{ nodeId: NodeKey, offset: number, limit: number, sortBy: SortField, sortDir: SortDirection, filterQuery?: string \| null }` | `NodeChildrenPage` | Returns a paginated, sorted, filtered slice of direct children for virtualized lists. |
| 8 | `get_treemap_subtree` | `{ nodeId: NodeKey, maxDepth: number, maxChildren: number }` | `SubtreeNodeDto` | Returns a bounded recursive subtree for 60fps Canvas Treemap/Sunburst rendering. |
| 9 | `get_node_breadcrumbs` | `{ nodeId: NodeKey }` | `BreadcrumbDto[]` | Walks parent pointers from `nodeId` to the active scan root (root-first order). |
| 10 | `get_dev_artifacts` | *(none)* | `ArtifactGroupDto[]` | Runs developer artifact detection across the active `SlotMap` arena. |
| 11 | `delete_nodes` | `{ request: DeleteRequest }` | `DeleteResult` | Validates every path via `ProtectedPathGuard`, deletes via Finder Trash (default) or permanent removal, and updates the arena in $O(\text{depth})$. |
| 12 | `reveal_in_finder` | `{ nodeId: NodeKey }` | `void` | Reveals the node's reconstructed path in macOS Finder via `tauri-plugin-opener`. |
