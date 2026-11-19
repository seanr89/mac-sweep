use std::cmp::Ordering;
use std::path::{Path, PathBuf};

use slotmap::{new_key_type, SlotMap};

use crate::ipc::types::{
    node_id_to_key, AppError, BreadcrumbDto, FileCategory, NodeChildrenPage, NodeSummaryDto,
    SortDirection, SortField, SubtreeNodeDto,
};

new_key_type! {
    /// Strongly typed generational arena index into `ArenaTree::nodes`.
    pub struct NodeId;
}

/// Compact per-entry node stored contiguously inside `SlotMap<NodeId, FileNode>`.
///
/// Only the filename segment (`Box<str>`) is stored per node; full paths are
/// reconstructed on demand by walking `parent` links back to `ArenaTree::root_path`.
#[derive(Debug, Clone)]
pub struct FileNode {
    pub parent: Option<NodeId>,
    pub name: Box<str>,
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
    pub children: Vec<NodeId>,
}

/// Summary statistics returned after removing a subtree from `ArenaTree`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RemovedSubtreeStats {
    pub physical_bytes: u64,
    pub logical_bytes: u64,
    pub removed_files: u64,
    pub removed_dirs: u64,
    pub freed_nodes: usize,
}

/// Arena-backed filesystem tree produced by a scan and queried by IPC commands.
#[derive(Debug)]
pub struct ArenaTree {
    pub nodes: SlotMap<NodeId, FileNode>,
    pub root: Option<NodeId>,
    pub root_path: PathBuf,
    pub hardlink_dedup_bytes: u64,
    pub permission_errors: u64,
}

impl ArenaTree {
    /// Create an empty arena rooted at `root_path`.
    pub fn new(root_path: PathBuf) -> Self {
        Self {
            nodes: SlotMap::with_key(),
            root: None,
            root_path,
            hardlink_dedup_bytes: 0,
            permission_errors: 0,
        }
    }

    /// Reconstruct the absolute filesystem path for `node_id` by walking `parent` pointers.
    pub fn reconstruct_path(&self, node_id: NodeId) -> Option<PathBuf> {
        let root_id = self.root?;
        let mut segments: Vec<&str> = Vec::new();
        let mut current = node_id;

        loop {
            let node = self.nodes.get(current)?;
            if current == root_id {
                break;
            }
            segments.push(&node.name);
            current = node.parent?;
        }

        let mut path = self.root_path.clone();
        for seg in segments.into_iter().rev() {
            path.push(seg);
        }
        Some(path)
    }

    /// Bottom-up iterative aggregation pass computing directory totals and
    /// sorting each directory's `children` descending by `physical_bytes`.
    pub fn aggregate_sizes(&mut self) {
        let Some(root_id) = self.root else {
            return;
        };

        // Build post-order traversal iteratively to avoid stack overflows on deep trees.
        let mut stack = Vec::with_capacity(1024);
        let mut order = Vec::with_capacity(self.nodes.len());
        stack.push(root_id);

        while let Some(id) = stack.pop() {
            order.push(id);
            if let Some(node) = self.nodes.get(id) {
                if node.is_dir {
                    stack.extend(node.children.iter().copied());
                }
            }
        }

        for id in order.into_iter().rev() {
            let is_dir = match self.nodes.get(id) {
                Some(n) => n.is_dir,
                None => continue,
            };

            if !is_dir {
                continue;
            }

            let mut children = match self.nodes.get_mut(id) {
                Some(n) => std::mem::take(&mut n.children),
                None => continue,
            };

            let mut phys_sum: u64 = 0;
            let mut logical_sum: u64 = 0;
            let mut files_sum: u64 = 0;
            let mut dirs_sum: u64 = 0;

            for &child_id in &children {
                if let Some(child) = self.nodes.get(child_id) {
                    phys_sum = phys_sum.saturating_add(child.physical_bytes);
                    logical_sum = logical_sum.saturating_add(child.logical_bytes);
                    files_sum = files_sum.saturating_add(child.file_count);
                    if child.is_dir {
                        dirs_sum = dirs_sum.saturating_add(1).saturating_add(child.dir_count);
                    }
                }
            }

            children.sort_unstable_by(|&a, &b| self.compare_nodes_desc_physical(a, b));

            if let Some(node) = self.nodes.get_mut(id) {
                node.physical_bytes = phys_sum;
                node.logical_bytes = logical_sum;
                node.file_count = files_sum;
                node.dir_count = dirs_sum;
                node.children = children;
            }
        }
    }

    /// Detach `node_id` from its parent, propagate decrements up the ancestor chain
    /// in O(depth), and reclaim `node_id` plus all descendant keys from the `SlotMap`.
    pub fn remove_subtree(&mut self, node_id: NodeId) -> Result<RemovedSubtreeStats, AppError> {
        let (parent, delta_phys, delta_logical, delta_files, delta_dirs) = {
            let node = self
                .nodes
                .get(node_id)
                .ok_or_else(|| AppError::NodeNotFound(node_id_to_key(node_id)))?;
            let delta_dirs = if node.is_dir {
                node.dir_count.saturating_add(1)
            } else {
                0
            };
            (
                node.parent,
                node.physical_bytes,
                node.logical_bytes,
                node.file_count,
                delta_dirs,
            )
        };

        // Detach from immediate parent.
        if let Some(parent_id) = parent {
            if let Some(parent_node) = self.nodes.get_mut(parent_id) {
                parent_node.children.retain(|&c| c != node_id);
            }
        }

        // Propagate size and count decrements up the ancestor chain in O(depth).
        let mut ancestor = parent;
        while let Some(anc_id) = ancestor {
            if let Some(anc_node) = self.nodes.get_mut(anc_id) {
                anc_node.physical_bytes = anc_node.physical_bytes.saturating_sub(delta_phys);
                anc_node.logical_bytes = anc_node.logical_bytes.saturating_sub(delta_logical);
                anc_node.file_count = anc_node.file_count.saturating_sub(delta_files);
                anc_node.dir_count = anc_node.dir_count.saturating_sub(delta_dirs);
                ancestor = anc_node.parent;
            } else {
                break;
            }
        }

        // Iteratively remove `node_id` and all descendants from SlotMap.
        let mut stack = vec![node_id];
        let mut freed_nodes = 0usize;
        while let Some(id) = stack.pop() {
            if let Some(removed) = self.nodes.remove(id) {
                freed_nodes += 1;
                stack.extend(removed.children);
            }
        }

        if self.root == Some(node_id) {
            self.root = None;
        }

        Ok(RemovedSubtreeStats {
            physical_bytes: delta_phys,
            logical_bytes: delta_logical,
            removed_files: delta_files,
            removed_dirs: delta_dirs,
            freed_nodes,
        })
    }

    /// Build a `NodeSummaryDto` for a single node.
    pub fn node_summary(&self, node_id: NodeId) -> Result<NodeSummaryDto, AppError> {
        let node = self
            .nodes
            .get(node_id)
            .ok_or_else(|| AppError::NodeNotFound(node_id_to_key(node_id)))?;
        let path = self
            .reconstruct_path(node_id)
            .ok_or_else(|| AppError::NodeNotFound(node_id_to_key(node_id)))?;

        let percent_of_parent = match node.parent {
            None => 100.0,
            Some(pid) => match self.nodes.get(pid) {
                Some(p) if p.physical_bytes > 0 => {
                    (node.physical_bytes as f64 / p.physical_bytes as f64) * 100.0
                }
                _ => 0.0,
            },
        };

        Ok(NodeSummaryDto {
            id: node_id_to_key(node_id),
            parent_id: node.parent.map(node_id_to_key),
            name: node.name.to_string(),
            path: path.to_string_lossy().into_owned(),
            is_dir: node.is_dir,
            is_symlink: node.is_symlink,
            is_hardlink_dup: node.is_hardlink_dup,
            permission_denied: node.permission_denied,
            physical_bytes: node.physical_bytes,
            logical_bytes: node.logical_bytes,
            file_count: node.file_count,
            dir_count: node.dir_count,
            modified_secs: node.modified_secs,
            category: node.category,
            percent_of_parent,
        })
    }

    /// Return a paginated, sorted, and optionally filtered slice of `node_id`'s direct children.
    pub fn get_children_page(
        &self,
        node_id: NodeId,
        offset: usize,
        limit: usize,
        sort_by: SortField,
        sort_dir: SortDirection,
        filter_query: Option<&str>,
    ) -> Result<NodeChildrenPage, AppError> {
        let parent = self.node_summary(node_id)?;
        let parent_node = self
            .nodes
            .get(node_id)
            .ok_or_else(|| AppError::NodeNotFound(node_id_to_key(node_id)))?;
        let parent_path = PathBuf::from(&parent.path);

        let normalized_filter = filter_query
            .map(str::trim)
            .filter(|q| !q.is_empty())
            .map(str::to_lowercase);

        let mut matching_ids: Vec<NodeId> = parent_node
            .children
            .iter()
            .copied()
            .filter(|&cid| {
                let Some(child) = self.nodes.get(cid) else {
                    return false;
                };
                match &normalized_filter {
                    Some(query) => child.name.to_lowercase().contains(query),
                    None => true,
                }
            })
            .collect();

        matching_ids.sort_unstable_by(|&a, &b| self.compare_nodes(a, b, sort_by, sort_dir));

        let total_count = matching_ids.len();
        let start = offset.min(total_count);
        let end = start.saturating_add(limit).min(total_count);
        let parent_phys = parent_node.physical_bytes;
        let parent_key = Some(node_id_to_key(node_id));

        let items = matching_ids[start..end]
            .iter()
            .filter_map(|&cid| {
                let child = self.nodes.get(cid)?;
                let child_path = parent_path.join(child.name.as_ref());
                let percent_of_parent = if parent_phys > 0 {
                    (child.physical_bytes as f64 / parent_phys as f64) * 100.0
                } else {
                    0.0
                };
                Some(NodeSummaryDto {
                    id: node_id_to_key(cid),
                    parent_id: parent_key.clone(),
                    name: child.name.to_string(),
                    path: child_path.to_string_lossy().into_owned(),
                    is_dir: child.is_dir,
                    is_symlink: child.is_symlink,
                    is_hardlink_dup: child.is_hardlink_dup,
                    permission_denied: child.permission_denied,
                    physical_bytes: child.physical_bytes,
                    logical_bytes: child.logical_bytes,
                    file_count: child.file_count,
                    dir_count: child.dir_count,
                    modified_secs: child.modified_secs,
                    category: child.category,
                    percent_of_parent,
                })
            })
            .collect::<Vec<_>>();

        let has_more = start.saturating_add(items.len()) < total_count;

        Ok(NodeChildrenPage {
            parent,
            items,
            total_count,
            offset: start,
            limit,
            has_more,
        })
    }

    /// Build a bounded recursive `SubtreeNodeDto` tailored for 60fps Canvas visualizations.
    ///
    /// Children are ordered descending by `physical_bytes`. When a directory has more
    /// children than `max_children`, tail children are pruned and their combined
    /// `physical_bytes` are accumulated into `aggregated_other_bytes` with
    /// `has_more_children = true`.
    pub fn build_viz_subtree(
        &self,
        node_id: NodeId,
        max_depth: usize,
        max_children: usize,
    ) -> Result<SubtreeNodeDto, AppError> {
        let base_path = self
            .reconstruct_path(node_id)
            .ok_or_else(|| AppError::NodeNotFound(node_id_to_key(node_id)))?;
        self.build_viz_subtree_inner(node_id, &base_path, 0, max_depth, max_children)
    }

    fn build_viz_subtree_inner(
        &self,
        node_id: NodeId,
        current_path: &Path,
        depth: usize,
        max_depth: usize,
        max_children: usize,
    ) -> Result<SubtreeNodeDto, AppError> {
        let node = self
            .nodes
            .get(node_id)
            .ok_or_else(|| AppError::NodeNotFound(node_id_to_key(node_id)))?;

        let (children, has_more_children, aggregated_other_bytes) =
            if !node.is_dir || node.children.is_empty() {
                (Vec::new(), false, 0)
            } else if depth >= max_depth {
                (Vec::new(), true, 0)
            } else {
                let mut sorted_children: Vec<NodeId> = node
                    .children
                    .iter()
                    .copied()
                    .filter(|&cid| self.nodes.contains_key(cid))
                    .collect();
                sorted_children.sort_unstable_by(|&a, &b| self.compare_nodes_desc_physical(a, b));

                let take_count = max_children.min(sorted_children.len());
                let has_more = sorted_children.len() > take_count;
                let other_bytes: u64 = if has_more {
                    sorted_children[take_count..]
                        .iter()
                        .filter_map(|&cid| self.nodes.get(cid))
                        .fold(0u64, |acc, c| acc.saturating_add(c.physical_bytes))
                } else {
                    0
                };

                let mut dto_children = Vec::with_capacity(take_count);
                for &child_id in &sorted_children[..take_count] {
                    if let Some(child) = self.nodes.get(child_id) {
                        let child_path = current_path.join(child.name.as_ref());
                        let dto = self.build_viz_subtree_inner(
                            child_id,
                            &child_path,
                            depth + 1,
                            max_depth,
                            max_children,
                        )?;
                        dto_children.push(dto);
                    }
                }

                (dto_children, has_more, other_bytes)
            };

        Ok(SubtreeNodeDto {
            id: node_id_to_key(node_id),
            name: node.name.to_string(),
            path: current_path.to_string_lossy().into_owned(),
            is_dir: node.is_dir,
            is_hardlink_dup: node.is_hardlink_dup,
            physical_bytes: node.physical_bytes,
            logical_bytes: node.logical_bytes,
            file_count: node.file_count,
            category: node.category,
            children,
            has_more_children,
            aggregated_other_bytes,
        })
    }

    /// Return the root-first breadcrumb trail from the active scan root to `node_id`.
    pub fn get_breadcrumbs(&self, node_id: NodeId) -> Result<Vec<BreadcrumbDto>, AppError> {
        let root_id = self.root.ok_or(AppError::NoActiveScan)?;
        let mut chain = Vec::new();
        let mut current = node_id;

        loop {
            let node = self
                .nodes
                .get(current)
                .ok_or_else(|| AppError::NodeNotFound(node_id_to_key(current)))?;
            chain.push(current);
            if current == root_id {
                break;
            }
            current = node
                .parent
                .ok_or_else(|| AppError::NodeNotFound(node_id_to_key(node_id)))?;
        }

        chain.reverse();

        let mut running_path = self.root_path.clone();
        let mut breadcrumbs = Vec::with_capacity(chain.len());

        for (idx, id) in chain.into_iter().enumerate() {
            let node = self
                .nodes
                .get(id)
                .ok_or_else(|| AppError::NodeNotFound(node_id_to_key(id)))?;
            if idx > 0 {
                running_path.push(node.name.as_ref());
            }
            breadcrumbs.push(BreadcrumbDto {
                id: node_id_to_key(id),
                name: node.name.to_string(),
                path: running_path.to_string_lossy().into_owned(),
                physical_bytes: node.physical_bytes,
            });
        }

        Ok(breadcrumbs)
    }

    fn compare_nodes_desc_physical(&self, a: NodeId, b: NodeId) -> Ordering {
        match (self.nodes.get(a), self.nodes.get(b)) {
            (Some(na), Some(nb)) => nb
                .physical_bytes
                .cmp(&na.physical_bytes)
                .then_with(|| nb.logical_bytes.cmp(&na.logical_bytes))
                .then_with(|| na.name.cmp(&nb.name)),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => Ordering::Equal,
        }
    }

    fn compare_nodes(
        &self,
        a: NodeId,
        b: NodeId,
        sort_by: SortField,
        sort_dir: SortDirection,
    ) -> Ordering {
        let (Some(na), Some(nb)) = (self.nodes.get(a), self.nodes.get(b)) else {
            return Ordering::Equal;
        };

        let primary = match sort_by {
            SortField::PhysicalBytes => na.physical_bytes.cmp(&nb.physical_bytes),
            SortField::LogicalBytes => na.logical_bytes.cmp(&nb.logical_bytes),
            SortField::Name => na
                .name
                .to_lowercase()
                .cmp(&nb.name.to_lowercase())
                .then_with(|| na.name.cmp(&nb.name)),
            SortField::FileCount => na.file_count.cmp(&nb.file_count),
            SortField::ModifiedSecs => na
                .modified_secs
                .unwrap_or(i64::MIN)
                .cmp(&nb.modified_secs.unwrap_or(i64::MIN)),
        };

        let ordered = match sort_dir {
            SortDirection::Asc => primary,
            SortDirection::Desc => primary.reverse(),
        };

        ordered
            .then_with(|| nb.physical_bytes.cmp(&na.physical_bytes))
            .then_with(|| na.name.cmp(&nb.name))
    }
}

/// Classify a filesystem entry into a high-level `FileCategory`.
pub fn classify_category(name: &str, is_dir: bool) -> FileCategory {
    if is_dir {
        return FileCategory::Directory;
    }

    let lower_name = name.to_ascii_lowercase();
    if lower_name == ".ds_store"
        || lower_name == "makefile"
        || lower_name == "dockerfile"
        || lower_name == "cargo.toml"
        || lower_name == "package.json"
    {
        return if lower_name == ".ds_store" {
            FileCategory::System
        } else {
            FileCategory::Code
        };
    }

    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);

    match ext.as_deref() {
        Some(
            "rs" | "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "py" | "go" | "java" | "kt"
            | "kts" | "swift" | "c" | "cc" | "cpp" | "cxx" | "h" | "hh" | "hpp" | "m" | "mm" | "cs"
            | "rb" | "php" | "sh" | "zsh" | "bash" | "fish" | "html" | "htm" | "css" | "scss"
            | "sass" | "less" | "vue" | "svelte" | "json" | "yaml" | "yml" | "toml" | "xml" | "sql"
            | "graphql" | "gql" | "proto" | "lock" | "wasm" | "rlib" | "rmeta" | "pyc" | "pyo"
            | "class" | "jar" | "map" | "md" | "mdx" | "o" | "a",
        ) => FileCategory::Code,

        Some(
            "mp4" | "mov" | "mkv" | "avi" | "webm" | "m4v" | "flv" | "wmv" | "mp3" | "wav" | "flac"
            | "aac" | "m4a" | "ogg" | "opus" | "aiff" | "aif" | "jpg" | "jpeg" | "png" | "gif"
            | "webp" | "heic" | "heif" | "tif" | "tiff" | "bmp" | "svg" | "ico" | "icns" | "cr2"
            | "nef" | "arw" | "dng" | "orf" | "rw2" | "psd" | "ai" | "fig" | "sketch" | "exr",
        ) => FileCategory::Media,

        Some(
            "zip" | "tar" | "gz" | "tgz" | "bz2" | "tbz2" | "xz" | "txz" | "zst" | "7z" | "rar"
            | "lz4" | "pkg" | "deb" | "rpm" | "xar" | "cpio" | "cab" | "war" | "ear",
        ) => FileCategory::Archive,

        Some(
            "dmg" | "iso" | "img" | "sparseimage" | "sparsebundle" | "raw" | "vmdk" | "vdi"
            | "qcow" | "qcow2" | "vhd" | "vhdx" | "cdr",
        ) => FileCategory::DiskImage,

        Some(
            "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "pages" | "numbers" | "key"
            | "txt" | "rtf" | "odt" | "ods" | "odp" | "csv" | "tsv" | "epub" | "mobi" | "log",
        ) => FileCategory::Document,

        Some(
            "dylib" | "so" | "dll" | "exe" | "kext" | "plist" | "mobileprovision" | "db" | "sqlite"
            | "sqlite3" | "wal" | "shm" | "cache" | "idx" | "pack" | "dsym" | "bin",
        ) => FileCategory::System,

        _ => FileCategory::Other,
    }
}
