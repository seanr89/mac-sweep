use serde::ser::SerializeStruct;
use serde::{Deserialize, Serialize, Serializer};
use slotmap::{Key, KeyData};
use thiserror::Error;

/// Decimal-stringified `u64` representation of a `slotmap::KeyData` FFI key.
///
/// Serializing as a decimal string avoids IEEE-754 53-bit integer precision loss
/// in JavaScript (`Number.MAX_SAFE_INTEGER` is `2^53 - 1`, whereas `SlotMap`
/// keys encode a 32-bit version in the upper bits of a `u64`).
pub type NodeKey = String;

/// Convert any `slotmap::Key` into a precision-safe decimal `NodeKey`.
pub fn node_id_to_key<K: Key>(id: K) -> NodeKey {
    id.data().as_ffi().to_string()
}

/// Parse a decimal `NodeKey` string back into a `slotmap::Key`.
pub fn key_to_node_id<K: Key>(key: &str) -> Result<K, AppError> {
    let raw = key
        .parse::<u64>()
        .map_err(|_| AppError::InvalidNodeKey(key.to_string()))?;
    Ok(K::from(KeyData::from_ffi(raw)))
}

/// Status of macOS Full Disk Access (TCC) permission probe.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FdaStatus {
    pub granted: bool,
    pub probed_path: String,
    pub settings_url: String,
}

/// Capacity metrics for a mounted APFS/POSIX volume.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskOverview {
    pub mount_point: String,
    pub volume_name: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub used_bytes: u64,
    pub purgeable_bytes: Option<u64>,
}

/// Streaming scan lifecycle events emitted over `tauri::ipc::Channel<ScanEvent>`.
///
/// `Progress` events MUST be throttled to at most once every 50–100ms.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ScanEvent {
    Started {
        scan_id: u64,
        root_path: String,
    },
    Progress {
        scan_id: u64,
        files_scanned: u64,
        dirs_scanned: u64,
        physical_bytes: u64,
        logical_bytes: u64,
        permission_errors: u64,
        current_path: String,
        elapsed_ms: u64,
    },
    Completed {
        scan_id: u64,
        root_id: NodeKey,
        root_path: String,
        total_files: u64,
        total_dirs: u64,
        total_physical_bytes: u64,
        total_logical_bytes: u64,
        hardlink_dedup_bytes: u64,
        permission_errors: u64,
        duration_ms: u64,
    },
    Cancelled {
        scan_id: u64,
        files_scanned: u64,
        elapsed_ms: u64,
    },
    Error {
        scan_id: u64,
        code: String,
        message: String,
    },
}

/// High-level visual and semantic classification for files and directories.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileCategory {
    Directory,
    Code,
    Media,
    Archive,
    DiskImage,
    Document,
    System,
    Other,
}

/// Detailed summary of a single filesystem node for list/inspector views.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeSummaryDto {
    pub id: NodeKey,
    pub parent_id: Option<NodeKey>,
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub is_hardlink_dup: bool,
    pub permission_denied: bool,
    pub physical_bytes: u64,
    pub logical_bytes: u64,
    pub file_count: u64,
    pub dir_count: u64,
    pub modified_secs: Option<i64>,
    pub category: FileCategory,
    pub percent_of_parent: f64,
}

/// Compact recursive subtree DTO tailored for 60fps HTML5 Canvas visualizations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtreeNodeDto {
    pub id: NodeKey,
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_hardlink_dup: bool,
    pub physical_bytes: u64,
    pub logical_bytes: u64,
    pub file_count: u64,
    pub category: FileCategory,
    pub children: Vec<SubtreeNodeDto>,
    pub has_more_children: bool,
    pub aggregated_other_bytes: u64,
}

/// Sort key for paginated directory children queries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SortField {
    PhysicalBytes,
    LogicalBytes,
    Name,
    FileCount,
    ModifiedSecs,
}

/// Sort ordering direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SortDirection {
    Asc,
    Desc,
}

/// Paginated slice of a directory's direct children.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeChildrenPage {
    pub parent: NodeSummaryDto,
    pub items: Vec<NodeSummaryDto>,
    pub total_count: usize,
    pub offset: usize,
    pub limit: usize,
    pub has_more: bool,
}

/// Ancestor trail segment from the active scan root to the focused node.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BreadcrumbDto {
    pub id: NodeKey,
    pub name: String,
    pub path: String,
    pub physical_bytes: u64,
}

/// Risk level annotation for detected developer/system cleanup artifacts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ArtifactRiskLevel {
    Safe,
    Caution,
}

/// A single detected reclaimable artifact matching a preset rule.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactMatchDto {
    pub node_id: NodeKey,
    pub group_id: String,
    pub name: String,
    pub path: String,
    pub project_name: Option<String>,
    pub physical_bytes: u64,
    pub logical_bytes: u64,
    pub file_count: u64,
    pub modified_secs: Option<i64>,
    pub risk: ArtifactRiskLevel,
}

/// Aggregated group of detected reclaimable developer artifacts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactGroupDto {
    pub id: String,
    pub label: String,
    pub description: String,
    pub risk: ArtifactRiskLevel,
    pub total_physical_bytes: u64,
    pub total_file_count: u64,
    pub item_count: usize,
    pub items: Vec<ArtifactMatchDto>,
}

/// Deletion strategy. Always defaults to `Trash` in UI and backend flows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeleteMode {
    #[default]
    Trash,
    Permanent,
}

/// Request payload for `delete_nodes`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRequest {
    pub node_ids: Vec<NodeKey>,
    pub mode: DeleteMode,
}

/// Per-item error entry when partial deletion occurs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteFailure {
    pub node_id: NodeKey,
    pub path: String,
    pub code: String,
    pub reason: String,
}

/// Result returned by `delete_nodes` after filesystem removal and O(depth) arena update.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
    pub deleted_node_ids: Vec<NodeKey>,
    pub reclaimed_physical_bytes: u64,
    pub reclaimed_logical_bytes: u64,
    pub failures: Vec<DeleteFailure>,
    pub updated_root: Option<NodeSummaryDto>,
}

/// Structured IPC error type serialized across Tauri commands as `{ code, message }`.
#[derive(Debug, Error)]
pub enum AppError {
    #[error("No active scan is loaded")]
    NoActiveScan,

    #[error("A scan is already in progress")]
    ScanInProgress,

    #[error("Invalid node key: {0}")]
    InvalidNodeKey(String),

    #[error("Node not found: {0}")]
    NodeNotFound(String),

    #[error("Refusing to modify protected path: {0}")]
    ProtectedPath(String),

    #[error("Target path is outside the active scan root: {0}")]
    PathOutsideScanRoot(String),

    #[error("Invalid path: {0}")]
    InvalidPath(String),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Failed to move item to Trash: {0}")]
    TrashFailed(String),

    #[error("Filesystem I/O error: {0}")]
    Io(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl AppError {
    /// Stable machine-readable error code for frontend branching.
    pub fn code(&self) -> &'static str {
        match self {
            Self::NoActiveScan => "NO_ACTIVE_SCAN",
            Self::ScanInProgress => "SCAN_IN_PROGRESS",
            Self::InvalidNodeKey(_) => "INVALID_NODE_KEY",
            Self::NodeNotFound(_) => "NODE_NOT_FOUND",
            Self::ProtectedPath(_) => "PROTECTED_PATH",
            Self::PathOutsideScanRoot(_) => "PATH_OUTSIDE_SCAN_ROOT",
            Self::InvalidPath(_) => "INVALID_PATH",
            Self::PermissionDenied(_) => "PERMISSION_DENIED",
            Self::TrashFailed(_) => "TRASH_FAILED",
            Self::Io(_) => "IO_ERROR",
            Self::Internal(_) => "INTERNAL_ERROR",
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        if err.kind() == std::io::ErrorKind::PermissionDenied {
            Self::PermissionDenied(err.to_string())
        } else {
            Self::Io(err.to_string())
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use slotmap::DefaultKey;

    #[test]
    fn scan_event_serializes_with_camel_case_tag_and_fields() {
        let ev = ScanEvent::Progress {
            scan_id: 7,
            files_scanned: 1200,
            dirs_scanned: 150,
            physical_bytes: 4096,
            logical_bytes: 8192,
            permission_errors: 2,
            current_path: "/Users/test".to_string(),
            elapsed_ms: 250,
        };
        let value = serde_json::to_value(&ev).expect("serialize ScanEvent");
        assert_eq!(value["type"], "progress");
        assert_eq!(value["scanId"], 7);
        assert_eq!(value["filesScanned"], 1200);
        assert_eq!(value["dirsScanned"], 150);
        assert_eq!(value["physicalBytes"], 4096);
        assert_eq!(value["logicalBytes"], 8192);
        assert_eq!(value["permissionErrors"], 2);
        assert_eq!(value["currentPath"], "/Users/test");
        assert_eq!(value["elapsedMs"], 250);
    }

    #[test]
    fn app_error_serializes_as_code_and_message() {
        let err = AppError::ProtectedPath("/System".to_string());
        let value = serde_json::to_value(&err).expect("serialize AppError");
        assert_eq!(value["code"], "PROTECTED_PATH");
        assert!(value["message"].as_str().unwrap_or("").contains("/System"));
    }

    #[test]
    fn node_key_roundtrips_high_bit_u64_slotmap_keys() {
        let mut map: slotmap::SlotMap<DefaultKey, ()> = slotmap::SlotMap::new();
        let id = map.insert(());
        let key = node_id_to_key(id);
        let parsed: DefaultKey = key_to_node_id(&key).expect("parse NodeKey");
        assert_eq!(id, parsed);
    }
}
