use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

use crate::arena::{ArenaTree, NodeId};
use crate::ipc::types::{
    key_to_node_id, AppError, DeleteFailure, DeleteMode, DeleteRequest, DeleteResult, NodeKey,
};

const SYSTEM_PROTECTED_PATHS: &[&str] = &[
    "/",
    "/System",
    "/System/Volumes",
    "/System/Volumes/Data",
    "/Applications",
    "/Users",
    "/Library",
    "/usr",
    "/bin",
    "/sbin",
    "/private",
    "/etc",
    "/private/etc",
    "/var",
    "/private/var",
    "/Volumes",
    "/cores",
    "/opt",
];

const HOME_PROTECTED_SUBDIRS: &[&str] = &[
    "Desktop",
    "Documents",
    "Downloads",
    "Library",
    "Applications",
    "Pictures",
    "Movies",
    "Music",
];

/// Defense-in-depth guard blocking deletion of critical macOS/user directories
/// and any path escaping the active scan root.
#[derive(Debug, Clone)]
pub struct ProtectedPathGuard {
    canonical_scan_root: PathBuf,
    raw_scan_root: PathBuf,
    protected_paths: HashSet<PathBuf>,
}

impl ProtectedPathGuard {
    /// Construct a guard for `scan_root` using the current user's `$HOME`.
    pub fn new(scan_root: PathBuf) -> Self {
        Self::with_home(scan_root, dirs::home_dir())
    }

    /// Construct a guard with an explicit `home_dir` (useful for deterministic testing).
    pub fn with_home(scan_root: PathBuf, home_dir: Option<PathBuf>) -> Self {
        let raw_scan_root = normalize_lexical(&scan_root);
        let canonical_scan_root =
            std::fs::canonicalize(&scan_root).unwrap_or_else(|_| raw_scan_root.clone());

        let mut protected_paths = HashSet::new();
        for &sys_path in SYSTEM_PROTECTED_PATHS {
            insert_protected(&mut protected_paths, Path::new(sys_path));
        }

        if let Some(home) = home_dir {
            insert_protected(&mut protected_paths, &home);
            for &subdir in HOME_PROTECTED_SUBDIRS {
                insert_protected(&mut protected_paths, &home.join(subdir));
            }
        }

        Self {
            canonical_scan_root,
            raw_scan_root,
            protected_paths,
        }
    }

    /// Validate that `target` is safe to delete (for both Trash and Permanent modes).
    ///
    /// Resolves parent symlinks via `canonicalize` without following a leaf symlink,
    /// rejects protected macOS/user root directories (including APFS `/System/Volumes/Data`
    /// firmlinked equivalents and case-insensitive variants on macOS), refuses deleting
    /// the scan root itself, and rejects any path escaping `scan_root`.
    pub fn validate_target(&self, target: &Path) -> Result<(), AppError> {
        let raw_normalized = normalize_lexical(target);
        let resolved = resolve_without_following_leaf(target);

        if self.is_protected_candidate(&raw_normalized) || self.is_protected_candidate(&resolved) {
            return Err(AppError::ProtectedPath(target.display().to_string()));
        }

        // Refuse deleting the active scan root itself.
        if protected_lookup_key(&resolved) == protected_lookup_key(&self.canonical_scan_root)
            || protected_lookup_key(&raw_normalized) == protected_lookup_key(&self.raw_scan_root)
        {
            return Err(AppError::ProtectedPath(target.display().to_string()));
        }

        // Verify strict containment inside the active scan root.
        if !resolved.starts_with(&self.canonical_scan_root) {
            return Err(AppError::PathOutsideScanRoot(target.display().to_string()));
        }

        Ok(())
    }

    fn is_protected_candidate(&self, candidate: &Path) -> bool {
        let key = protected_lookup_key(candidate);
        if self.protected_paths.contains(&key) {
            return true;
        }

        // Guard against APFS firmlink bypasses via `/System/Volumes/Data/...`.
        let data_prefix = protected_lookup_key(Path::new("/System/Volumes/Data"));
        if let Ok(stripped) = key.strip_prefix(&data_prefix) {
            let rerooted = Path::new("/").join(stripped);
            if self.protected_paths.contains(&rerooted) {
                return true;
            }
        }

        false
    }
}

/// Safely delete nodes identified by `NodeKey` from disk and update `ArenaTree` in O(depth).
///
/// - Deduplicates descendant nodes when an ancestor is also requested.
/// - Validates every target through `ProtectedPathGuard` before touching the filesystem.
/// - Defaults to Finder Trash (`trash::delete`) for `DeleteMode::Trash`.
/// - Never follows symlinks during `DeleteMode::Permanent`.
/// - Immediately updates `ArenaTree` via `remove_subtree` after each successful deletion.
pub fn delete_nodes(
    arena: &mut ArenaTree,
    request: DeleteRequest,
) -> Result<DeleteResult, AppError> {
    let guard = ProtectedPathGuard::new(arena.root_path.clone());

    let mut parsed_targets: Vec<(NodeKey, NodeId)> = Vec::with_capacity(request.node_ids.len());
    let mut seen_ids: HashSet<NodeId> = HashSet::with_capacity(request.node_ids.len());
    let mut failures: Vec<DeleteFailure> = Vec::new();

    for key in request.node_ids {
        match key_to_node_id::<NodeId>(&key) {
            Ok(id) => {
                if !arena.nodes.contains_key(id) {
                    let err = AppError::NodeNotFound(key.clone());
                    failures.push(DeleteFailure {
                        node_id: key,
                        path: String::new(),
                        code: err.code().to_string(),
                        reason: err.to_string(),
                    });
                    continue;
                }
                if seen_ids.insert(id) {
                    parsed_targets.push((key, id));
                }
            }
            Err(err) => {
                failures.push(DeleteFailure {
                    node_id: key,
                    path: String::new(),
                    code: err.code().to_string(),
                    reason: err.to_string(),
                });
            }
        }
    }

    // Prune descendants when an ancestor is also in the deletion batch.
    let top_level_targets: Vec<(NodeKey, NodeId)> = parsed_targets
        .into_iter()
        .filter(|&(_, id)| !has_ancestor_in_set(arena, id, &seen_ids))
        .collect();

    let mut deleted_node_ids: Vec<NodeKey> = Vec::with_capacity(top_level_targets.len());
    let mut reclaimed_physical_bytes: u64 = 0;
    let mut reclaimed_logical_bytes: u64 = 0;

    for (key, node_id) in top_level_targets {
        let Some(path) = arena.reconstruct_path(node_id) else {
            let err = AppError::NodeNotFound(key.clone());
            failures.push(DeleteFailure {
                node_id: key,
                path: String::new(),
                code: err.code().to_string(),
                reason: err.to_string(),
            });
            continue;
        };

        let path_str = path.to_string_lossy().into_owned();

        if let Err(err) = guard.validate_target(&path) {
            failures.push(DeleteFailure {
                node_id: key,
                path: path_str,
                code: err.code().to_string(),
                reason: err.to_string(),
            });
            continue;
        }

        let delete_outcome = match request.mode {
            DeleteMode::Trash => {
                trash::delete(&path).map_err(|e| AppError::TrashFailed(e.to_string()))
            }
            DeleteMode::Permanent => remove_permanently_no_follow(&path),
        };

        if let Err(err) = delete_outcome {
            failures.push(DeleteFailure {
                node_id: key,
                path: path_str,
                code: err.code().to_string(),
                reason: err.to_string(),
            });
            continue;
        }

        // Disk deletion succeeded: immediately update the arena in O(depth).
        if let Ok(stats) = arena.remove_subtree(node_id) {
            reclaimed_physical_bytes =
                reclaimed_physical_bytes.saturating_add(stats.physical_bytes);
            reclaimed_logical_bytes = reclaimed_logical_bytes.saturating_add(stats.logical_bytes);
            deleted_node_ids.push(key);
        }
    }

    let updated_root = arena
        .root
        .and_then(|root_id| arena.node_summary(root_id).ok());

    Ok(DeleteResult {
        deleted_node_ids,
        reclaimed_physical_bytes,
        reclaimed_logical_bytes,
        failures,
        updated_root,
    })
}

fn remove_permanently_no_follow(path: &Path) -> Result<(), AppError> {
    let meta = std::fs::symlink_metadata(path)?;
    let ft = meta.file_type();
    if ft.is_symlink() || !ft.is_dir() {
        std::fs::remove_file(path)?;
    } else {
        std::fs::remove_dir_all(path)?;
    }
    Ok(())
}

fn has_ancestor_in_set(arena: &ArenaTree, node_id: NodeId, set: &HashSet<NodeId>) -> bool {
    let mut cursor = arena.nodes.get(node_id).and_then(|n| n.parent);
    while let Some(anc_id) = cursor {
        if set.contains(&anc_id) {
            return true;
        }
        cursor = arena.nodes.get(anc_id).and_then(|n| n.parent);
    }
    false
}

fn insert_protected(set: &mut HashSet<PathBuf>, path: &Path) {
    let normalized = normalize_lexical(path);
    set.insert(protected_lookup_key(&normalized));
    if let Ok(canonical) = std::fs::canonicalize(path) {
        set.insert(protected_lookup_key(&canonical));
    }
}

/// Normalize a path for protected-set membership comparison.
///
/// On macOS (default case-insensitive APFS), folds to lowercase so case
/// variations such as `/system` or `/Users/<user>/desktop` cannot bypass checks.
#[cfg(target_os = "macos")]
fn protected_lookup_key(path: &Path) -> PathBuf {
    PathBuf::from(path.to_string_lossy().to_lowercase())
}

#[cfg(not(target_os = "macos"))]
fn protected_lookup_key(path: &Path) -> PathBuf {
    path.to_path_buf()
}

/// Resolve parent symlinks via `fs::canonicalize` without dereferencing the leaf entry.
fn resolve_without_following_leaf(path: &Path) -> PathBuf {
    let normalized = normalize_lexical(path);
    if normalized == Path::new("/") {
        return normalized;
    }

    let Some(file_name) = normalized.file_name() else {
        return normalized;
    };
    let Some(parent) = normalized.parent() else {
        return normalized;
    };

    if let Ok(canon_parent) = std::fs::canonicalize(parent) {
        canon_parent.join(file_name)
    } else {
        normalized
    }
}

/// Pure lexical path normalization collapsing `.` and `..` components without I/O.
fn normalize_lexical(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::Prefix(p) => out.push(p.as_os_str()),
            Component::RootDir => out.push(Path::new("/")),
            Component::CurDir => {}
            Component::ParentDir => {
                if out != Path::new("/") {
                    out.pop();
                }
            }
            Component::Normal(seg) => out.push(seg),
        }
    }
    if out.as_os_str().is_empty() {
        PathBuf::from("/")
    } else {
        out
    }
}
