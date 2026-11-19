use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use parking_lot::{Mutex, RwLock};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::arena::{ArenaTree, NodeId};
use crate::artifacts;
use crate::cleanup;
use crate::ipc::types::{
    key_to_node_id, node_id_to_key, AppError, ArtifactGroupDto, BreadcrumbDto, DeleteRequest,
    DeleteResult, DiskOverview, FdaStatus, NodeChildrenPage, NodeKey, ScanEvent, SortDirection,
    SortField, SubtreeNodeDto,
};
use crate::macos;
use crate::scanner::{self, ScanOutcome};

/// Shared thread-safe engine state managed by Tauri.
pub struct AppState {
    pub arena: RwLock<Option<ArenaTree>>,
    pub active_scan: Mutex<Option<(u64, Arc<AtomicBool>)>>,
    pub next_scan_id: AtomicU64,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            arena: RwLock::new(None),
            active_scan: Mutex::new(None),
            next_scan_id: AtomicU64::new(1),
        }
    }

    fn clear_active_scan(&self, scan_id: u64) {
        let mut active = self.active_scan.lock();
        if matches!(*active, Some((id, _)) if id == scan_id) {
            *active = None;
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

/// Ensures `active_scan` is cleared even if the background scan exits early.
struct ActiveScanGuard {
    state: Arc<AppState>,
    scan_id: u64,
    cleared: bool,
}

impl ActiveScanGuard {
    fn new(state: Arc<AppState>, scan_id: u64) -> Self {
        Self {
            state,
            scan_id,
            cleared: false,
        }
    }

    fn clear_now(&mut self) {
        if !self.cleared {
            self.state.clear_active_scan(self.scan_id);
            self.cleared = true;
        }
    }
}

impl Drop for ActiveScanGuard {
    fn drop(&mut self) {
        self.clear_now();
    }
}

#[tauri::command]
pub fn check_full_disk_access() -> Result<FdaStatus, AppError> {
    Ok(macos::probe_full_disk_access())
}

#[tauri::command]
pub fn open_fda_settings() -> Result<(), AppError> {
    macos::open_fda_settings()
}

fn expand_tilde(raw: &str) -> Result<PathBuf, AppError> {
    let trimmed = raw.trim();
    if trimmed == "~" {
        return dirs::home_dir().ok_or_else(|| {
            AppError::InvalidPath("Unable to resolve home directory for '~'".to_string())
        });
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        let home = dirs::home_dir().ok_or_else(|| {
            AppError::InvalidPath(format!("Unable to resolve home directory for '{trimmed}'"))
        })?;
        return Ok(home.join(rest));
    }
    Ok(PathBuf::from(trimmed))
}

#[tauri::command]
pub fn get_disk_overview(path: Option<String>) -> Result<DiskOverview, AppError> {
    let expanded = match path.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(raw) => Some(expand_tilde(raw)?),
        None => None,
    };
    macos::get_disk_overview(expanded.as_deref())
}

#[tauri::command]
pub async fn pick_scan_directory(app: AppHandle) -> Result<Option<String>, AppError> {
    let picked =
        tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
            .await
            .map_err(|err| AppError::Internal(format!("Folder picker task failed: {err}")))?;

    match picked {
        Some(file_path) => {
            let path = file_path
                .into_path()
                .map_err(|err| AppError::InvalidPath(err.to_string()))?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn start_scan(
    state: State<'_, Arc<AppState>>,
    path: String,
    on_event: Channel<ScanEvent>,
) -> Result<u64, AppError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidPath(
            "Scan path cannot be empty".to_string(),
        ));
    }

    let root_path = expand_tilde(trimmed)?;
    let meta = std::fs::metadata(&root_path).map_err(|err| match err.kind() {
        std::io::ErrorKind::PermissionDenied => {
            AppError::PermissionDenied(root_path.display().to_string())
        }
        std::io::ErrorKind::NotFound => AppError::InvalidPath(root_path.display().to_string()),
        _ => AppError::from(err),
    })?;
    if !meta.is_dir() {
        return Err(AppError::InvalidPath(format!(
            "Target is not a directory: {}",
            root_path.display()
        )));
    }

    let (scan_id, cancel_flag) = {
        let mut active = state.active_scan.lock();
        if active.is_some() {
            return Err(AppError::ScanInProgress);
        }
        let id = state.next_scan_id.fetch_add(1, Ordering::Relaxed);
        let flag = Arc::new(AtomicBool::new(false));
        *active = Some((id, Arc::clone(&flag)));
        (id, flag)
    };

    let state_arc = Arc::clone(state.inner());
    let root_path_str = root_path.to_string_lossy().into_owned();

    let _ = on_event.send(ScanEvent::Started {
        scan_id,
        root_path: root_path_str,
    });

    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = ActiveScanGuard::new(Arc::clone(&state_arc), scan_id);

        let outcome = scanner::scan_directory(scan_id, &root_path, cancel_flag, |progress_event| {
            let _ = on_event.send(progress_event);
        });

        match outcome {
            Ok(ScanOutcome::Completed(completed)) => {
                let root_id_key = node_id_to_key(completed.root_id);
                let completed_root_path = completed.arena.root_path.to_string_lossy().into_owned();
                let total_files = completed.total_files;
                let total_dirs = completed.total_dirs;
                let total_physical_bytes = completed.total_physical_bytes;
                let total_logical_bytes = completed.total_logical_bytes;
                let hardlink_dedup_bytes = completed.hardlink_dedup_bytes;
                let permission_errors = completed.permission_errors;
                let duration_ms = completed.duration_ms;

                // Swap finished arena into shared state BEFORE emitting `Completed`
                // so immediate frontend queries always observe the new tree.
                {
                    let mut arena_slot = state_arc.arena.write();
                    *arena_slot = Some(completed.arena);
                }
                guard.clear_now();

                let _ = on_event.send(ScanEvent::Completed {
                    scan_id,
                    root_id: root_id_key,
                    root_path: completed_root_path,
                    total_files,
                    total_dirs,
                    total_physical_bytes,
                    total_logical_bytes,
                    hardlink_dedup_bytes,
                    permission_errors,
                    duration_ms,
                });
            }
            Ok(ScanOutcome::Cancelled {
                files_scanned,
                elapsed_ms,
            }) => {
                guard.clear_now();
                let _ = on_event.send(ScanEvent::Cancelled {
                    scan_id,
                    files_scanned,
                    elapsed_ms,
                });
            }
            Err(err) => {
                guard.clear_now();
                let _ = on_event.send(ScanEvent::Error {
                    scan_id,
                    code: err.code().to_string(),
                    message: err.to_string(),
                });
            }
        }
    });

    Ok(scan_id)
}

#[tauri::command]
pub fn cancel_scan(state: State<'_, Arc<AppState>>) -> Result<bool, AppError> {
    let active = state.active_scan.lock();
    if let Some((_, cancel_flag)) = active.as_ref() {
        cancel_flag.store(true, Ordering::Relaxed);
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub fn get_node_children(
    state: State<'_, Arc<AppState>>,
    node_id: NodeKey,
    offset: usize,
    limit: usize,
    sort_by: SortField,
    sort_dir: SortDirection,
    filter_query: Option<String>,
) -> Result<NodeChildrenPage, AppError> {
    let parsed_id: NodeId = key_to_node_id(&node_id)?;
    let guard = state.arena.read();
    let arena = guard.as_ref().ok_or(AppError::NoActiveScan)?;
    arena.get_children_page(
        parsed_id,
        offset,
        limit,
        sort_by,
        sort_dir,
        filter_query.as_deref(),
    )
}

#[tauri::command]
pub fn get_treemap_subtree(
    state: State<'_, Arc<AppState>>,
    node_id: NodeKey,
    max_depth: usize,
    max_children: usize,
) -> Result<SubtreeNodeDto, AppError> {
    let parsed_id: NodeId = key_to_node_id(&node_id)?;
    let guard = state.arena.read();
    let arena = guard.as_ref().ok_or(AppError::NoActiveScan)?;
    arena.build_viz_subtree(parsed_id, max_depth, max_children)
}

#[tauri::command]
pub fn get_node_breadcrumbs(
    state: State<'_, Arc<AppState>>,
    node_id: NodeKey,
) -> Result<Vec<BreadcrumbDto>, AppError> {
    let parsed_id: NodeId = key_to_node_id(&node_id)?;
    let guard = state.arena.read();
    let arena = guard.as_ref().ok_or(AppError::NoActiveScan)?;
    arena.get_breadcrumbs(parsed_id)
}

#[tauri::command]
pub fn get_dev_artifacts(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ArtifactGroupDto>, AppError> {
    let guard = state.arena.read();
    let arena = guard.as_ref().ok_or(AppError::NoActiveScan)?;
    Ok(artifacts::detect_dev_artifacts(arena))
}

#[tauri::command]
pub async fn delete_nodes(
    state: State<'_, Arc<AppState>>,
    request: DeleteRequest,
) -> Result<DeleteResult, AppError> {
    let state_arc = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = state_arc.arena.write();
        let arena = guard.as_mut().ok_or(AppError::NoActiveScan)?;
        cleanup::delete_nodes(arena, request)
    })
    .await
    .map_err(|err| AppError::Internal(format!("Delete task failed: {err}")))?
}

#[tauri::command]
pub fn reveal_in_finder(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    node_id: NodeKey,
) -> Result<(), AppError> {
    let parsed_id: NodeId = key_to_node_id(&node_id)?;
    let path = {
        let guard = state.arena.read();
        let arena = guard.as_ref().ok_or(AppError::NoActiveScan)?;
        arena
            .reconstruct_path(parsed_id)
            .ok_or(AppError::NodeNotFound(node_id))?
    };

    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|err| AppError::Io(err.to_string()))
}
