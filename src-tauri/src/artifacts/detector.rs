use std::collections::HashMap;
use std::path::Path;

use crate::arena::{ArenaTree, NodeId};
use crate::ipc::types::{node_id_to_key, ArtifactGroupDto, ArtifactMatchDto, ArtifactRiskLevel};

#[derive(Debug, Clone, Copy)]
struct GroupMeta {
    id: &'static str,
    label: &'static str,
    description: &'static str,
    risk: ArtifactRiskLevel,
}

const NODE_MODULES_GROUP: GroupMeta = GroupMeta {
    id: "node-modules",
    label: "Node.js Dependencies",
    description:
        "Reinstallable node_modules directories across JavaScript and TypeScript projects.",
    risk: ArtifactRiskLevel::Safe,
};

const CARGO_TARGET_GROUP: GroupMeta = GroupMeta {
    id: "cargo-target",
    label: "Rust Build Artifacts",
    description: "Cargo target/ build output directories adjacent to Cargo.toml manifests.",
    risk: ArtifactRiskLevel::Safe,
};

const XCODE_DERIVED_DATA_GROUP: GroupMeta = GroupMeta {
    id: "xcode-derived-data",
    label: "Xcode DerivedData",
    description: "Intermediate Xcode build products and index caches that regenerate on build.",
    risk: ArtifactRiskLevel::Safe,
};

const FRONTEND_BUILDS_GROUP: GroupMeta = GroupMeta {
    id: "frontend-builds",
    label: "Frontend Build Caches",
    description: "Generated .next, .nuxt, .turbo, and dist build outputs in package.json projects.",
    risk: ArtifactRiskLevel::Safe,
};

const PYTHON_ENVS_GROUP: GroupMeta = GroupMeta {
    id: "python-envs",
    label: "Python Environments & Bytecode",
    description: "Recreatable .venv, venv virtual environments and __pycache__ bytecode caches.",
    risk: ArtifactRiskLevel::Safe,
};

const COCOAPODS_GROUP: GroupMeta = GroupMeta {
    id: "cocoapods",
    label: "CocoaPods Dependencies",
    description: "Installed Pods/ directories adjacent to a Podfile (restorable via pod install).",
    risk: ArtifactRiskLevel::Safe,
};

const PACKAGE_CACHES_GROUP: GroupMeta = GroupMeta {
    id: "package-caches",
    label: "Package Manager Caches",
    description: "Local download caches for Homebrew, npm, pnpm, and Cargo registries.",
    risk: ArtifactRiskLevel::Safe,
};

/// Zero-I/O pass over `ArenaTree` detecting reclaimable macOS developer artifacts.
///
/// Never descends into an already-matched artifact directory so nested artifacts
/// (such as `node_modules/pkg/node_modules`) are never double-reported.
pub fn detect_dev_artifacts(arena: &ArenaTree) -> Vec<ArtifactGroupDto> {
    let Some(root_id) = arena.root else {
        return Vec::new();
    };

    let mut grouped: HashMap<&'static str, (GroupMeta, Vec<ArtifactMatchDto>)> = HashMap::new();
    let mut stack: Vec<NodeId> = Vec::with_capacity(512);

    // Traverse starting from root's children so the scan root itself is never flagged.
    if let Some(root_node) = arena.nodes.get(root_id) {
        stack.extend(root_node.children.iter().copied());
    }

    while let Some(node_id) = stack.pop() {
        let Some(node) = arena.nodes.get(node_id) else {
            continue;
        };

        if !node.is_dir || node.is_symlink {
            continue;
        }

        if let Some((meta, project_name)) = match_artifact(arena, node_id, &node.name, node.parent)
        {
            let path = arena
                .reconstruct_path(node_id)
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_else(|| node.name.to_string());

            let item = ArtifactMatchDto {
                node_id: node_id_to_key(node_id),
                group_id: meta.id.to_string(),
                name: node.name.to_string(),
                path,
                project_name,
                physical_bytes: node.physical_bytes,
                logical_bytes: node.logical_bytes,
                file_count: node.file_count,
                modified_secs: node.modified_secs,
                risk: meta.risk,
            };

            grouped
                .entry(meta.id)
                .or_insert_with(|| (meta, Vec::new()))
                .1
                .push(item);

            // Do NOT descend into matched artifact directories to avoid nested double-counting.
            continue;
        }

        stack.extend(node.children.iter().copied());
    }

    let mut result: Vec<ArtifactGroupDto> = grouped
        .into_values()
        .filter(|(_, items)| !items.is_empty())
        .map(|(meta, mut items)| {
            items.sort_unstable_by(|a, b| {
                b.physical_bytes
                    .cmp(&a.physical_bytes)
                    .then_with(|| a.path.cmp(&b.path))
            });

            let total_physical_bytes = items
                .iter()
                .fold(0u64, |acc, item| acc.saturating_add(item.physical_bytes));
            let total_file_count = items
                .iter()
                .fold(0u64, |acc, item| acc.saturating_add(item.file_count));
            let item_count = items.len();

            ArtifactGroupDto {
                id: meta.id.to_string(),
                label: meta.label.to_string(),
                description: meta.description.to_string(),
                risk: meta.risk,
                total_physical_bytes,
                total_file_count,
                item_count,
                items,
            }
        })
        .collect();

    result.sort_unstable_by(|a, b| {
        b.total_physical_bytes
            .cmp(&a.total_physical_bytes)
            .then_with(|| a.id.cmp(&b.id))
    });

    result
}

fn match_artifact(
    arena: &ArenaTree,
    node_id: NodeId,
    name: &str,
    parent: Option<NodeId>,
) -> Option<(GroupMeta, Option<String>)> {
    match name {
        "node_modules" => {
            let project = parent_project_name(arena, parent);
            Some((NODE_MODULES_GROUP, project))
        }
        "target" => {
            if has_sibling(arena, parent, "Cargo.toml") {
                let project = parent_project_name(arena, parent);
                Some((CARGO_TARGET_GROUP, project))
            } else {
                None
            }
        }
        "DerivedData" => {
            if path_ends_with_components(arena, node_id, &["Xcode", "DerivedData"]) {
                Some((XCODE_DERIVED_DATA_GROUP, Some("Xcode".to_string())))
            } else {
                None
            }
        }
        ".next" | ".nuxt" | ".turbo" | "dist" => {
            if has_sibling(arena, parent, "package.json") {
                let project = parent_project_name(arena, parent);
                Some((FRONTEND_BUILDS_GROUP, project))
            } else {
                None
            }
        }
        ".venv" | "venv" | "__pycache__" => {
            let project = parent_project_name(arena, parent);
            Some((PYTHON_ENVS_GROUP, project))
        }
        "Pods" => {
            if has_sibling(arena, parent, "Podfile") {
                let project = parent_project_name(arena, parent);
                Some((COCOAPODS_GROUP, project))
            } else {
                None
            }
        }
        "Homebrew" => {
            if path_ends_with_components(arena, node_id, &["Library", "Caches", "Homebrew"]) {
                Some((PACKAGE_CACHES_GROUP, Some("Homebrew".to_string())))
            } else {
                None
            }
        }
        "_cacache" => {
            if path_ends_with_components(arena, node_id, &[".npm", "_cacache"]) {
                Some((PACKAGE_CACHES_GROUP, Some("npm".to_string())))
            } else {
                None
            }
        }
        "npm" => {
            if path_ends_with_components(arena, node_id, &["Library", "Caches", "npm"]) {
                Some((PACKAGE_CACHES_GROUP, Some("npm".to_string())))
            } else {
                None
            }
        }
        "pnpm" => {
            if path_ends_with_components(arena, node_id, &["Library", "Caches", "pnpm"]) {
                Some((PACKAGE_CACHES_GROUP, Some("pnpm".to_string())))
            } else {
                None
            }
        }
        ".pnpm-store" => Some((PACKAGE_CACHES_GROUP, Some("pnpm".to_string()))),
        "cache" => {
            if path_ends_with_components(arena, node_id, &[".cargo", "registry", "cache"]) {
                Some((PACKAGE_CACHES_GROUP, Some("Cargo".to_string())))
            } else {
                None
            }
        }
        "src" => {
            if path_ends_with_components(arena, node_id, &[".cargo", "registry", "src"]) {
                Some((PACKAGE_CACHES_GROUP, Some("Cargo".to_string())))
            } else {
                None
            }
        }
        _ => None,
    }
}

fn has_sibling(arena: &ArenaTree, parent: Option<NodeId>, sibling_name: &str) -> bool {
    let Some(parent_id) = parent else {
        return false;
    };
    let Some(parent_node) = arena.nodes.get(parent_id) else {
        return false;
    };
    parent_node.children.iter().any(|&cid| {
        arena
            .nodes
            .get(cid)
            .map(|c| c.name.as_ref() == sibling_name)
            .unwrap_or(false)
    })
}

fn parent_project_name(arena: &ArenaTree, parent: Option<NodeId>) -> Option<String> {
    let parent_id = parent?;
    let parent_node = arena.nodes.get(parent_id)?;
    let name = parent_node.name.as_ref();
    if name.is_empty() || name == "/" {
        None
    } else {
        Some(name.to_string())
    }
}

fn path_ends_with_components(arena: &ArenaTree, node_id: NodeId, suffix: &[&str]) -> bool {
    let Some(path) = arena.reconstruct_path(node_id) else {
        return false;
    };
    let suffix_path = suffix.iter().fold(std::path::PathBuf::new(), |mut acc, s| {
        acc.push(s);
        acc
    });
    path_ends_with(&path, &suffix_path)
}

fn path_ends_with(path: &Path, suffix: &Path) -> bool {
    path.ends_with(suffix)
}
