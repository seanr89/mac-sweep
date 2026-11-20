use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

use crate::arena::{ArenaTree, NodeId};
use crate::ipc::types::{
    key_to_node_id, AppError, DeleteFailure, DeleteMode, DeleteRequest, DeleteResult, NodeKey,
};

/// macOS `<sys/stat.h>` flag (`SF_DATALESS`) indicating a cloud placeholder
/// file or directory whose data blocks are not materialized locally.
#[cfg(target_os = "macos")]
const SF_DATALESS: u32 = 0x4000_0000;

/// Maximum directory entries inspected when checking a failed trash target
/// for iCloud dataless (`SF_DATALESS`) or `.icloud` placeholder files.
const MAX_DATALESS_PROBE_ENTRIES: usize = 2_048;

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
/// - Defaults to Finder Trash (`NSFileManager.trashItemAtURL` on macOS) for `DeleteMode::Trash`.
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
            DeleteMode::Trash => move_to_trash(&path),
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

#[cfg(target_os = "macos")]
fn macos_trash_context() -> trash::TrashContext {
    use trash::macos::{DeleteMethod, TrashContextExtMacos};
    let mut ctx = trash::TrashContext::new();
    ctx.set_delete_method(DeleteMethod::NsFileManager);
    ctx
}

fn move_to_trash(path: &Path) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    let result = macos_trash_context().delete(path);

    #[cfg(not(target_os = "macos"))]
    let result = trash::delete(path);

    result.map_err(|err| format_trash_error(path, &err))
}

fn extract_trash_error_detail(err: &trash::Error) -> String {
    match err {
        trash::Error::Unknown { description } | trash::Error::Os { description, .. } => {
            let trimmed = description.trim();
            if trimmed.is_empty() {
                err.to_string()
            } else {
                trimmed.to_string()
            }
        }
        _ => err.to_string(),
    }
}

fn is_icloud_download_required_message(msg: &str) -> bool {
    let lower = msg.to_lowercase();
    [
        "needs to be downloaded",
        "need to be downloaded",
        "isn't downloaded",
        "isn’t downloaded",
        "not downloaded",
        "-8013",
        "nsubiquitousfileunavailableerror",
        "cocoa error 4355",
        "code=4355",
        "code: 4355",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn is_icloud_stub_file_name(name: &std::ffi::OsStr) -> bool {
    let s = name.to_string_lossy();
    s.len() > ".icloud".len() && s.starts_with('.') && s.ends_with(".icloud")
}

#[cfg(target_os = "macos")]
fn is_dataless_metadata(meta: &std::fs::Metadata) -> bool {
    use std::os::macos::fs::MetadataExt as MacosMetadataExt;
    (meta.st_flags() & SF_DATALESS) != 0
}

#[cfg(not(target_os = "macos"))]
fn is_dataless_metadata(_meta: &std::fs::Metadata) -> bool {
    false
}

fn path_contains_dataless_or_icloud_stub(path: &Path) -> bool {
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return false;
    };
    if path.file_name().is_some_and(is_icloud_stub_file_name) || is_dataless_metadata(&meta) {
        return true;
    }

    if !meta.file_type().is_dir() || meta.file_type().is_symlink() {
        return false;
    }

    let mut stack = vec![path.to_path_buf()];
    let mut inspected: usize = 0;

    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            inspected += 1;
            if inspected > MAX_DATALESS_PROBE_ENTRIES {
                return false;
            }
            if is_icloud_stub_file_name(&entry.file_name()) {
                return true;
            }
            let entry_path = entry.path();
            let Ok(child_meta) = std::fs::symlink_metadata(&entry_path) else {
                continue;
            };
            if is_dataless_metadata(&child_meta) {
                return true;
            }
            let ft = child_meta.file_type();
            if ft.is_dir() && !ft.is_symlink() {
                stack.push(entry_path);
            }
        }
    }

    false
}

fn format_trash_error(path: &Path, err: &trash::Error) -> AppError {
    let detail = extract_trash_error_detail(err);
    if is_icloud_download_required_message(&detail) || path_contains_dataless_or_icloud_stub(path) {
        let item_name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string());
        return AppError::TrashFailed(format!(
            "\"{item_name}\" contains iCloud Drive items that are not downloaded locally. Download it in Finder first, or choose \"Delete permanently (bypass Finder Trash)\" to remove it directly without downloading."
        ));
    }
    AppError::TrashFailed(detail)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_trash_context_uses_ns_file_manager_delete_method() {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        assert!(matches!(
            macos_trash_context().delete_method(),
            DeleteMethod::NsFileManager
        ));
    }

    #[test]
    fn formats_finder_8013_and_cocoa_4355_errors_with_actionable_icloud_guidance() {
        let target = Path::new("/Users/test/Documents/PitchMate/node_modules");

        let finder_err = trash::Error::Os {
            code: 1,
            description: "The AppleScript exited with error. stderr: 29:154: execution error: Finder got an error: The operation can’t be completed because the item needs to be downloaded. (-8013)\n".to_string(),
        };
        let formatted_finder = format_trash_error(target, &finder_err);
        match &formatted_finder {
            AppError::TrashFailed(msg) => {
                assert!(msg.contains("node_modules"));
                assert!(msg.contains("iCloud Drive"));
                assert!(msg.contains("Delete permanently (bypass Finder Trash)"));
                assert!(!msg.contains("Os { code: 1"));
            }
            other => panic!("expected AppError::TrashFailed, got {other:?}"),
        }

        let cocoa_err = trash::Error::Unknown {
            description: "While deleting 'node_modules', `trashItemAtURL` failed: Error Domain=NSCocoaErrorDomain Code=4355 \"The file couldn’t be opened because it isn’t in the correct format.\"".to_string(),
        };
        let formatted_cocoa = format_trash_error(target, &cocoa_err);
        match &formatted_cocoa {
            AppError::TrashFailed(msg) => {
                assert!(msg.contains("iCloud Drive"));
                assert!(msg.contains("Delete permanently (bypass Finder Trash)"));
            }
            other => panic!("expected AppError::TrashFailed, got {other:?}"),
        }
    }

    #[test]
    fn detects_icloud_placeholder_stubs_inside_directory_on_trash_failure() {
        let dir = TempDir::new().expect("create temp dir");
        let nm = dir.path().join("node_modules");
        let nested = nm.join("pkg");
        fs::create_dir_all(&nested).expect("create nested dirs");
        fs::write(nested.join(".package.json.icloud"), b"stub").expect("write .icloud stub");

        let err = trash::Error::Unknown {
            description: "trashItemAtURL failed".to_string(),
        };
        let formatted = format_trash_error(&nm, &err);
        match &formatted {
            AppError::TrashFailed(msg) => {
                assert!(msg.contains("node_modules"));
                assert!(msg.contains("iCloud Drive"));
                assert!(msg.contains("Delete permanently (bypass Finder Trash)"));
            }
            other => panic!("expected AppError::TrashFailed, got {other:?}"),
        }
    }
}
