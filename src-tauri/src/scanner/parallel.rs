use std::collections::HashMap;
use std::io::ErrorKind;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use dashmap::DashSet;
use jwalk::{Parallelism, WalkDirGeneric};

use crate::arena::{classify_category, ArenaTree, FileNode, NodeId};
use crate::ipc::types::{AppError, FileCategory, ScanEvent};
use crate::macos::should_skip_path;

/// Throttle interval for streaming `ScanEvent::Progress` updates (target 75ms).
const PROGRESS_THROTTLE: Duration = Duration::from_millis(75);

/// Per-entry metadata computed in parallel inside `jwalk::process_read_dir`.
#[derive(Debug, Clone, Copy)]
struct ScannedMeta {
    is_dir: bool,
    is_symlink: bool,
    is_hardlink_dup: bool,
    permission_denied: bool,
    physical_bytes: u64,
    logical_bytes: u64,
    modified_secs: Option<i64>,
}

/// Completed scan payload ready to be swapped into `AppState` prior to emitting `ScanEvent::Completed`.
#[derive(Debug)]
pub struct CompletedScan {
    pub arena: ArenaTree,
    pub root_id: NodeId,
    pub total_files: u64,
    pub total_dirs: u64,
    pub total_physical_bytes: u64,
    pub total_logical_bytes: u64,
    pub hardlink_dedup_bytes: u64,
    pub permission_errors: u64,
    pub duration_ms: u64,
}

/// Terminal outcome of `scan_directory`.
#[derive(Debug)]
pub enum ScanOutcome {
    Completed(Box<CompletedScan>),
    Cancelled { files_scanned: u64, elapsed_ms: u64 },
}

/// Perform a parallel APFS-aware directory scan rooted at `root_path`.
///
/// Streams throttled `ScanEvent::Progress` updates via `on_event` (at most once
/// every 75ms). The caller is responsible for emitting `ScanEvent::Started`
/// before calling and `ScanEvent::Completed` / `ScanEvent::Cancelled` /
/// `ScanEvent::Error` after updating shared application state.
pub fn scan_directory<F>(
    scan_id: u64,
    root_path: &Path,
    cancel_flag: Arc<AtomicBool>,
    mut on_event: F,
) -> Result<ScanOutcome, AppError>
where
    F: FnMut(ScanEvent),
{
    let start = Instant::now();
    let normalized_root = normalize_root_path(root_path);

    let root_meta = std::fs::metadata(&normalized_root).map_err(|err| match err.kind() {
        ErrorKind::PermissionDenied => {
            AppError::PermissionDenied(normalized_root.display().to_string())
        }
        ErrorKind::NotFound => AppError::InvalidPath(normalized_root.display().to_string()),
        _ => AppError::from(err),
    })?;

    if !root_meta.is_dir() {
        return Err(AppError::InvalidPath(format!(
            "Scan target is not a directory: {}",
            normalized_root.display()
        )));
    }

    let root_name: Box<str> = if normalized_root == Path::new("/") {
        "/".into()
    } else {
        normalized_root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| normalized_root.to_string_lossy().into_owned())
            .into_boxed_str()
    };

    let mut arena = ArenaTree::new(normalized_root.clone());
    let root_id = arena.nodes.insert(FileNode {
        parent: None,
        name: root_name,
        is_dir: true,
        is_symlink: false,
        is_hardlink_dup: false,
        permission_denied: false,
        physical_bytes: 0,
        logical_bytes: 0,
        file_count: 0,
        dir_count: 0,
        modified_secs: system_time_to_secs(root_meta.modified().ok()),
        category: FileCategory::Directory,
        children: Vec::new(),
    });
    arena.root = Some(root_id);

    let mut dir_map: HashMap<PathBuf, NodeId> = HashMap::with_capacity(4096);
    dir_map.insert(normalized_root.clone(), root_id);

    // Concurrent state shared with Rayon workers inside `process_read_dir`.
    let seen_hardlinks: Arc<DashSet<(u64, u64)>> = Arc::new(DashSet::new());
    let files_scanned = Arc::new(AtomicU64::new(0));
    let dirs_scanned = Arc::new(AtomicU64::new(1));
    let progress_physical = Arc::new(AtomicU64::new(0));
    let progress_logical = Arc::new(AtomicU64::new(0));
    let hardlink_dedup_bytes = Arc::new(AtomicU64::new(0));
    let permission_errors = Arc::new(AtomicU64::new(0));

    let scan_root_for_cb = normalized_root.clone();
    let cancel_for_cb = Arc::clone(&cancel_flag);
    let seen_for_cb = Arc::clone(&seen_hardlinks);
    let files_for_cb = Arc::clone(&files_scanned);
    let dirs_for_cb = Arc::clone(&dirs_scanned);
    let phys_for_cb = Arc::clone(&progress_physical);
    let logical_for_cb = Arc::clone(&progress_logical);
    let dedup_for_cb = Arc::clone(&hardlink_dedup_bytes);
    let perm_for_cb = Arc::clone(&permission_errors);

    let walk = WalkDirGeneric::<((), Option<ScannedMeta>)>::new(&normalized_root)
        .follow_links(false)
        .skip_hidden(false)
        .parallelism(Parallelism::RayonDefaultPool {
            busy_timeout: Duration::from_secs(1),
        })
        .process_read_dir(move |_depth, _dir_path, _read_dir_state, children| {
            if cancel_for_cb.load(Ordering::Relaxed) {
                children.clear();
                return;
            }

            children.retain_mut(|entry_res| {
                let Ok(dir_entry) = entry_res else {
                    // Keep `Err` so the collector can count/mark unreadable directories.
                    return true;
                };

                let entry_path = dir_entry.path();
                if should_skip_path(&entry_path, &scan_root_for_cb) {
                    dir_entry.read_children_path = None;
                    return false;
                }

                match std::fs::symlink_metadata(&entry_path) {
                    Ok(meta) => {
                        let ft = meta.file_type();
                        let is_dir = ft.is_dir();
                        let is_symlink = ft.is_symlink();

                        if is_symlink {
                            dir_entry.read_children_path = None;
                        }

                        let mut physical_bytes = if is_dir {
                            0
                        } else {
                            meta.blocks().saturating_mul(512)
                        };
                        let logical_bytes = if is_dir { 0 } else { meta.size() };
                        let mut is_hardlink_dup = false;

                        if !is_dir
                            && meta.nlink() > 1
                            && !seen_for_cb.insert((meta.dev(), meta.ino()))
                        {
                            is_hardlink_dup = true;
                            dedup_for_cb.fetch_add(physical_bytes, Ordering::Relaxed);
                            physical_bytes = 0;
                        }

                        if is_dir {
                            dirs_for_cb.fetch_add(1, Ordering::Relaxed);
                        } else {
                            files_for_cb.fetch_add(1, Ordering::Relaxed);
                            phys_for_cb.fetch_add(physical_bytes, Ordering::Relaxed);
                            logical_for_cb.fetch_add(logical_bytes, Ordering::Relaxed);
                        }

                        dir_entry.client_state = Some(ScannedMeta {
                            is_dir,
                            is_symlink,
                            is_hardlink_dup,
                            permission_denied: false,
                            physical_bytes,
                            logical_bytes,
                            modified_secs: system_time_to_secs(meta.modified().ok()),
                        });
                        true
                    }
                    Err(err) if err.kind() == ErrorKind::PermissionDenied => {
                        perm_for_cb.fetch_add(1, Ordering::Relaxed);
                        dir_entry.read_children_path = None;
                        dir_entry.client_state = Some(ScannedMeta {
                            is_dir: dir_entry.file_type.is_dir(),
                            is_symlink: dir_entry.file_type.is_symlink(),
                            is_hardlink_dup: false,
                            permission_denied: true,
                            physical_bytes: 0,
                            logical_bytes: 0,
                            modified_secs: None,
                        });
                        true
                    }
                    Err(_) => {
                        // Transient error (e.g., vanished temp file) — skip gracefully.
                        dir_entry.read_children_path = None;
                        false
                    }
                }
            });
        });

    let mut last_emit = Instant::now();

    for entry_res in walk {
        if cancel_flag.load(Ordering::Relaxed) {
            return Ok(ScanOutcome::Cancelled {
                files_scanned: files_scanned.load(Ordering::Relaxed),
                elapsed_ms: start.elapsed().as_millis() as u64,
            });
        }

        match entry_res {
            Ok(entry) => {
                if entry.depth == 0 {
                    continue;
                }

                let entry_path = entry.path();
                let parent_path = entry.parent_path();

                let Some(parent_id) =
                    ensure_parent_dir(&mut arena, &mut dir_map, &normalized_root, parent_path)
                else {
                    continue;
                };

                let meta = match entry.client_state {
                    Some(m) => m,
                    None => ScannedMeta {
                        is_dir: entry.file_type.is_dir(),
                        is_symlink: entry.file_type.is_symlink(),
                        is_hardlink_dup: false,
                        permission_denied: false,
                        physical_bytes: 0,
                        logical_bytes: 0,
                        modified_secs: None,
                    },
                };

                let name_str = entry.file_name.to_string_lossy();
                let category = classify_category(&name_str, meta.is_dir);

                if meta.is_dir {
                    if let Some(&existing_id) = dir_map.get(&entry_path) {
                        if let Some(existing) = arena.nodes.get_mut(existing_id) {
                            existing.is_dir = true;
                            existing.is_symlink = meta.is_symlink;
                            existing.permission_denied |= meta.permission_denied;
                            existing.modified_secs = meta.modified_secs;
                            existing.category = FileCategory::Directory;
                        }
                    } else {
                        let node_id = arena.nodes.insert(FileNode {
                            parent: Some(parent_id),
                            name: name_str.into_owned().into_boxed_str(),
                            is_dir: true,
                            is_symlink: meta.is_symlink,
                            is_hardlink_dup: false,
                            permission_denied: meta.permission_denied,
                            physical_bytes: 0,
                            logical_bytes: 0,
                            file_count: 0,
                            dir_count: 0,
                            modified_secs: meta.modified_secs,
                            category: FileCategory::Directory,
                            children: Vec::new(),
                        });
                        if let Some(parent_node) = arena.nodes.get_mut(parent_id) {
                            parent_node.children.push(node_id);
                        }
                        dir_map.insert(entry_path.clone(), node_id);
                    }
                } else {
                    let node_id = arena.nodes.insert(FileNode {
                        parent: Some(parent_id),
                        name: name_str.into_owned().into_boxed_str(),
                        is_dir: false,
                        is_symlink: meta.is_symlink,
                        is_hardlink_dup: meta.is_hardlink_dup,
                        permission_denied: meta.permission_denied,
                        physical_bytes: meta.physical_bytes,
                        logical_bytes: meta.logical_bytes,
                        file_count: 1,
                        dir_count: 0,
                        modified_secs: meta.modified_secs,
                        category,
                        children: Vec::new(),
                    });
                    if let Some(parent_node) = arena.nodes.get_mut(parent_id) {
                        parent_node.children.push(node_id);
                    }
                }

                if last_emit.elapsed() >= PROGRESS_THROTTLE {
                    on_event(ScanEvent::Progress {
                        scan_id,
                        files_scanned: files_scanned.load(Ordering::Relaxed),
                        dirs_scanned: dirs_scanned.load(Ordering::Relaxed),
                        physical_bytes: progress_physical.load(Ordering::Relaxed),
                        logical_bytes: progress_logical.load(Ordering::Relaxed),
                        permission_errors: permission_errors.load(Ordering::Relaxed),
                        current_path: entry_path.to_string_lossy().into_owned(),
                        elapsed_ms: start.elapsed().as_millis() as u64,
                    });
                    last_emit = Instant::now();
                }
            }
            Err(err) => {
                let is_perm = err
                    .io_error()
                    .map(|e| e.kind() == ErrorKind::PermissionDenied)
                    .unwrap_or(false);
                if is_perm {
                    permission_errors.fetch_add(1, Ordering::Relaxed);
                }
                if let Some(err_path) = err.path() {
                    if let Some(&dir_id) = dir_map.get(err_path) {
                        if let Some(node) = arena.nodes.get_mut(dir_id) {
                            node.permission_denied = true;
                        }
                    }
                }
            }
        }
    }

    if cancel_flag.load(Ordering::Relaxed) {
        return Ok(ScanOutcome::Cancelled {
            files_scanned: files_scanned.load(Ordering::Relaxed),
            elapsed_ms: start.elapsed().as_millis() as u64,
        });
    }

    // Free directory lookup index before aggregation to minimize peak memory.
    drop(dir_map);
    drop(seen_hardlinks);

    let dedup_bytes = hardlink_dedup_bytes.load(Ordering::Relaxed);
    let perm_errs = permission_errors.load(Ordering::Relaxed);
    arena.hardlink_dedup_bytes = dedup_bytes;
    arena.permission_errors = perm_errs;
    arena.aggregate_sizes();

    let (total_files, total_dirs, total_physical_bytes, total_logical_bytes) = arena
        .nodes
        .get(root_id)
        .map(|r| {
            (
                r.file_count,
                r.dir_count.saturating_add(1),
                r.physical_bytes,
                r.logical_bytes,
            )
        })
        .unwrap_or((0, 1, 0, 0));

    let duration_ms = start.elapsed().as_millis() as u64;

    Ok(ScanOutcome::Completed(Box::new(CompletedScan {
        arena,
        root_id,
        total_files,
        total_dirs,
        total_physical_bytes,
        total_logical_bytes,
        hardlink_dedup_bytes: dedup_bytes,
        permission_errors: perm_errs,
        duration_ms,
    })))
}

/// Ensure `parent_path` exists in `dir_map`, creating placeholder intermediate
/// directory nodes if parallel traversal delivers a child before its ancestor.
fn ensure_parent_dir(
    arena: &mut ArenaTree,
    dir_map: &mut HashMap<PathBuf, NodeId>,
    root_path: &Path,
    parent_path: &Path,
) -> Option<NodeId> {
    if let Some(&id) = dir_map.get(parent_path) {
        return Some(id);
    }

    if !parent_path.starts_with(root_path) {
        return None;
    }

    let mut missing_chain: Vec<PathBuf> = Vec::new();
    let mut cursor = parent_path.to_path_buf();
    let mut anchor_id = None;

    while cursor != root_path {
        if let Some(&id) = dir_map.get(&cursor) {
            anchor_id = Some(id);
            break;
        }
        missing_chain.push(cursor.clone());
        let parent = cursor.parent()?;
        cursor = parent.to_path_buf();
    }

    let mut current_parent = anchor_id.or_else(|| dir_map.get(root_path).copied())?;
    for dir_path in missing_chain.into_iter().rev() {
        let name = dir_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
            .into_boxed_str();
        let id = arena.nodes.insert(FileNode {
            parent: Some(current_parent),
            name,
            is_dir: true,
            is_symlink: false,
            is_hardlink_dup: false,
            permission_denied: false,
            physical_bytes: 0,
            logical_bytes: 0,
            file_count: 0,
            dir_count: 0,
            modified_secs: None,
            category: FileCategory::Directory,
            children: Vec::new(),
        });
        if let Some(parent_node) = arena.nodes.get_mut(current_parent) {
            parent_node.children.push(id);
        }
        dir_map.insert(dir_path, id);
        current_parent = id;
    }

    Some(current_parent)
}

fn normalize_root_path(path: &Path) -> PathBuf {
    let raw = path.to_string_lossy();
    if raw == "/" {
        return PathBuf::from("/");
    }
    let trimmed = raw.trim_end_matches('/');
    if trimmed.is_empty() {
        PathBuf::from("/")
    } else {
        PathBuf::from(trimmed)
    }
}

fn system_time_to_secs(time: Option<SystemTime>) -> Option<i64> {
    let ts = time?;
    match ts.duration_since(UNIX_EPOCH) {
        Ok(d) => i64::try_from(d.as_secs()).ok(),
        Err(err) => i64::try_from(err.duration().as_secs()).ok().map(|v| -v),
    }
}
