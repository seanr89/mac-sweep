use std::fs::{self, File};
use std::io::Write;
use std::os::unix::fs as unix_fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use mac_sweep_lib::arena::{classify_category, ArenaTree, NodeId};
use mac_sweep_lib::artifacts::detect_dev_artifacts;
use mac_sweep_lib::cleanup::{delete_nodes, ProtectedPathGuard};
use mac_sweep_lib::ipc::types::{
    node_id_to_key, AppError, DeleteMode, DeleteRequest, FileCategory, SortDirection, SortField,
};
use mac_sweep_lib::macos::{
    get_disk_overview, probe_full_disk_access, should_skip_path, FDA_SETTINGS_URL,
};
use mac_sweep_lib::scanner::{scan_directory, CompletedScan, ScanOutcome};
use tempfile::TempDir;

fn run_scan_expect_completed(root: &Path) -> CompletedScan {
    let cancel = Arc::new(AtomicBool::new(false));
    let outcome = scan_directory(1, root, cancel, |_| {}).expect("scan should succeed");
    match outcome {
        ScanOutcome::Completed(completed) => *completed,
        ScanOutcome::Cancelled { .. } => panic!("expected Completed, got Cancelled"),
    }
}

fn find_node_by_name(arena: &ArenaTree, name: &str) -> Option<NodeId> {
    arena
        .nodes
        .iter()
        .find(|(_, node)| node.name.as_ref() == name)
        .map(|(id, _)| id)
}

#[test]
fn sparse_file_reports_logical_bytes_without_inflating_physical_bytes() {
    let dir = TempDir::new().expect("create temp dir");
    let sparse_path = dir.path().join("docker.raw");
    let file = File::create(&sparse_path).expect("create sparse file");
    file.set_len(64 * 1024 * 1024)
        .expect("set_len 64 MiB sparse");
    drop(file);

    let completed = run_scan_expect_completed(dir.path());
    let sparse_id = find_node_by_name(&completed.arena, "docker.raw").expect("sparse node found");
    let sparse_node = &completed.arena.nodes[sparse_id];

    assert_eq!(sparse_node.logical_bytes, 67_108_864);
    assert!(
        sparse_node.physical_bytes < 1_048_576,
        "expected sparse physical_bytes < 1 MiB, got {}",
        sparse_node.physical_bytes
    );
    assert_eq!(sparse_node.category, FileCategory::DiskImage);
    assert_eq!(completed.total_logical_bytes, 67_108_864);
    assert!(completed.total_physical_bytes < 1_048_576);
}

#[test]
fn hard_links_are_deduplicated_and_counted_once() {
    let dir = TempDir::new().expect("create temp dir");
    let orig_path = dir.path().join("payload_orig.bin");
    let link1_path = dir.path().join("payload_link1.bin");
    let link2_path = dir.path().join("payload_link2.bin");

    let payload = vec![0xABu8; 64 * 1024];
    let mut f = File::create(&orig_path).expect("create orig file");
    f.write_all(&payload).expect("write 64 KiB payload");
    f.sync_all().expect("sync orig file");
    drop(f);

    fs::hard_link(&orig_path, &link1_path).expect("create hard link 1");
    fs::hard_link(&orig_path, &link2_path).expect("create hard link 2");

    let completed = run_scan_expect_completed(dir.path());

    let mut dup_count = 0usize;
    let mut non_dup_phys: Vec<u64> = Vec::new();
    for (_, node) in &completed.arena.nodes {
        if !node.is_dir {
            if node.is_hardlink_dup {
                dup_count += 1;
                assert_eq!(
                    node.physical_bytes, 0,
                    "duplicate hard link must have 0 physical bytes"
                );
                assert_eq!(node.logical_bytes, 64 * 1024);
            } else {
                non_dup_phys.push(node.physical_bytes);
                assert_eq!(node.logical_bytes, 64 * 1024);
            }
        }
    }

    assert_eq!(dup_count, 2, "expected exactly 2 duplicate hard links");
    assert_eq!(non_dup_phys.len(), 1, "expected 1 primary hard link entry");
    assert!(
        non_dup_phys[0] >= 64 * 1024,
        "expected primary physical bytes >= 64 KiB, got {}",
        non_dup_phys[0]
    );
    assert_eq!(
        completed.total_physical_bytes, non_dup_phys[0],
        "root physical bytes should count hard-linked payload exactly once"
    );
    assert_eq!(
        completed.total_logical_bytes,
        3 * 64 * 1024,
        "logical bytes preserved for all 3 links"
    );
    assert!(
        completed.hardlink_dedup_bytes >= 2 * 64 * 1024,
        "expected hardlink_dedup_bytes >= 128 KiB, got {}",
        completed.hardlink_dedup_bytes
    );
}

#[test]
fn symlink_cycle_and_external_symlink_are_not_traversed() {
    let scan_dir = TempDir::new().expect("create scan temp dir");
    let external_dir = TempDir::new().expect("create external temp dir");

    // Put a large file inside the external directory.
    let ext_file = external_dir.path().join("external_big.bin");
    fs::write(&ext_file, vec![0x55u8; 256 * 1024]).expect("write external file");

    // Create a nested subdirectory with a symlink looping back to the scan root.
    let nested = scan_dir.path().join("nested");
    fs::create_dir(&nested).expect("create nested dir");
    fs::write(nested.join("inside.txt"), b"hello world").expect("write inside.txt");

    unix_fs::symlink(scan_dir.path(), nested.join("loop_to_root")).expect("create loop symlink");
    unix_fs::symlink(
        external_dir.path(),
        scan_dir.path().join("link_to_external"),
    )
    .expect("create external symlink");

    let completed = run_scan_expect_completed(scan_dir.path());

    // Must complete without infinite recursion and must NOT include external_big.bin.
    assert!(
        find_node_by_name(&completed.arena, "external_big.bin").is_none(),
        "external symlink target must not be traversed"
    );

    let loop_id = find_node_by_name(&completed.arena, "loop_to_root").expect("loop symlink node");
    let ext_link_id =
        find_node_by_name(&completed.arena, "link_to_external").expect("external symlink node");

    assert!(completed.arena.nodes[loop_id].is_symlink);
    assert!(!completed.arena.nodes[loop_id].is_dir);
    assert!(completed.arena.nodes[ext_link_id].is_symlink);
    assert!(!completed.arena.nodes[ext_link_id].is_dir);
    assert!(completed.total_physical_bytes < 128 * 1024);
}

#[test]
fn apfs_firmlink_and_volumes_skip_policy() {
    let root = Path::new("/");

    // Virtual mounts are always skipped.
    assert!(should_skip_path(Path::new("/dev"), root));
    assert!(should_skip_path(Path::new("/dev/null"), root));
    assert!(should_skip_path(Path::new("/net"), root));
    assert!(should_skip_path(Path::new("/home"), root));
    assert!(should_skip_path(Path::new("/.vol"), root));

    // APFS Data volume skipped unless explicitly targeted.
    assert!(should_skip_path(Path::new("/System/Volumes/Data"), root));
    assert!(should_skip_path(
        Path::new("/System/Volumes/Data/Users"),
        root
    ));
    assert!(should_skip_path(
        Path::new("/System/Volumes/Data"),
        Path::new("/System/Volumes")
    ));
    assert!(!should_skip_path(
        Path::new("/System/Volumes/Data/Users"),
        Path::new("/System/Volumes/Data")
    ));
    assert!(!should_skip_path(
        Path::new("/System/Volumes/Data/Users/sean"),
        Path::new("/System/Volumes/Data/Users")
    ));

    // `/Volumes` skipped during root `/` scan, allowed when scanning `/Volumes/<vol>`.
    assert!(should_skip_path(Path::new("/Volumes"), root));
    assert!(should_skip_path(Path::new("/Volumes/ExternalSSD"), root));
    assert!(!should_skip_path(
        Path::new("/Volumes/ExternalSSD"),
        Path::new("/Volumes/ExternalSSD")
    ));
    assert!(!should_skip_path(
        Path::new("/Volumes/ExternalSSD/Projects"),
        Path::new("/Volumes/ExternalSSD")
    ));

    // Normal user paths are never skipped.
    assert!(!should_skip_path(Path::new("/Users/sean"), root));
    assert!(!should_skip_path(
        Path::new("/Applications/Xcode.app"),
        root
    ));
}

#[test]
fn arena_remove_subtree_propagates_to_ancestors_and_reclaims_keys() {
    let dir = TempDir::new().expect("create temp dir");
    let sub_a = dir.path().join("alpha");
    let sub_b = dir.path().join("beta");
    let deep = sub_a.join("deep");
    fs::create_dir_all(&deep).expect("create alpha/deep");
    fs::create_dir_all(&sub_b).expect("create beta");

    fs::write(deep.join("f1.bin"), vec![1u8; 32 * 1024]).expect("write f1");
    fs::write(deep.join("f2.bin"), vec![2u8; 16 * 1024]).expect("write f2");
    fs::write(sub_a.join("f3.bin"), vec![3u8; 8 * 1024]).expect("write f3");
    fs::write(sub_b.join("b1.bin"), vec![4u8; 12 * 1024]).expect("write b1");

    let mut completed = run_scan_expect_completed(dir.path());
    let arena = &mut completed.arena;
    let root_id = completed.root_id;

    let initial_root_phys = arena.nodes[root_id].physical_bytes;
    let initial_root_logical = arena.nodes[root_id].logical_bytes;
    let initial_root_files = arena.nodes[root_id].file_count;
    let initial_root_dirs = arena.nodes[root_id].dir_count;
    let initial_slot_len = arena.nodes.len();

    let alpha_id = find_node_by_name(arena, "alpha").expect("alpha dir");
    let deep_id = find_node_by_name(arena, "deep").expect("deep dir");
    let f1_id = find_node_by_name(arena, "f1.bin").expect("f1 file");
    let f2_id = find_node_by_name(arena, "f2.bin").expect("f2 file");

    let deep_phys = arena.nodes[deep_id].physical_bytes;
    let deep_logical = arena.nodes[deep_id].logical_bytes;
    let alpha_phys_before = arena.nodes[alpha_id].physical_bytes;

    // Verify breadcrumbs before removal.
    let crumbs = arena.get_breadcrumbs(f1_id).expect("breadcrumbs for f1");
    assert_eq!(crumbs.len(), 4);
    assert_eq!(crumbs[0].id, node_id_to_key(root_id));
    assert_eq!(crumbs[1].name, "alpha");
    assert_eq!(crumbs[2].name, "deep");
    assert_eq!(crumbs[3].name, "f1.bin");

    // Verify viz subtree pruning + aggregated_other_bytes.
    let pruned = arena
        .build_viz_subtree(root_id, 2, 1)
        .expect("build pruned subtree");
    assert_eq!(pruned.children.len(), 1);
    assert!(pruned.has_more_children);
    assert_eq!(
        pruned.children[0].physical_bytes + pruned.aggregated_other_bytes,
        initial_root_phys
    );

    // Verify paginated query with filter.
    let page = arena
        .get_children_page(
            deep_id,
            0,
            10,
            SortField::PhysicalBytes,
            SortDirection::Desc,
            Some("f1"),
        )
        .expect("filtered children page");
    assert_eq!(page.total_count, 1);
    assert_eq!(page.items[0].name, "f1.bin");

    // Remove `deep` subtree (contains `deep`, `f1.bin`, `f2.bin` => 3 nodes).
    let stats = arena.remove_subtree(deep_id).expect("remove deep subtree");
    assert_eq!(stats.freed_nodes, 3);
    assert_eq!(stats.removed_files, 2);
    assert_eq!(stats.removed_dirs, 1);
    assert_eq!(stats.physical_bytes, deep_phys);
    assert_eq!(stats.logical_bytes, deep_logical);

    // Keys must be reclaimed from SlotMap.
    assert!(!arena.nodes.contains_key(deep_id));
    assert!(!arena.nodes.contains_key(f1_id));
    assert!(!arena.nodes.contains_key(f2_id));
    assert_eq!(arena.nodes.len(), initial_slot_len - 3);

    // Ancestors updated accurately in O(depth).
    assert_eq!(
        arena.nodes[alpha_id].physical_bytes,
        alpha_phys_before - deep_phys
    );
    assert_eq!(arena.nodes[alpha_id].file_count, 1);
    assert_eq!(arena.nodes[alpha_id].dir_count, 0);

    assert_eq!(
        arena.nodes[root_id].physical_bytes,
        initial_root_phys - deep_phys
    );
    assert_eq!(
        arena.nodes[root_id].logical_bytes,
        initial_root_logical - deep_logical
    );
    assert_eq!(arena.nodes[root_id].file_count, initial_root_files - 2);
    assert_eq!(arena.nodes[root_id].dir_count, initial_root_dirs - 1);
}

#[test]
fn artifact_detector_matches_dev_projects_without_false_positives_or_double_counting() {
    let dir = TempDir::new().expect("create temp dir");

    // 1. Valid Rust project: Cargo.toml + target/ -> MUST match.
    let rust_proj = dir.path().join("my-rust-app");
    fs::create_dir_all(rust_proj.join("target/debug")).expect("create rust target");
    fs::write(
        rust_proj.join("Cargo.toml"),
        b"[package]\nname = \"demo\"\n",
    )
    .expect("write Cargo.toml");
    fs::write(rust_proj.join("target/debug/demo"), vec![0xAAu8; 32 * 1024])
        .expect("write rust binary");

    // 2. Bare target/ directory WITHOUT Cargo.toml -> MUST NOT match.
    let non_rust = dir.path().join("random-folder");
    fs::create_dir_all(non_rust.join("target")).expect("create bare target");
    fs::write(non_rust.join("target/data.txt"), vec![0xBBu8; 16 * 1024]).expect("write bare file");

    // 3. Nested node_modules -> ONLY outer node_modules matched (no nested double-counting).
    let web_proj = dir.path().join("my-web-app");
    let outer_nm = web_proj.join("node_modules");
    let nested_nm = outer_nm.join("some-pkg/node_modules");
    fs::create_dir_all(&nested_nm).expect("create nested node_modules");
    fs::write(web_proj.join("package.json"), b"{\"name\":\"web\"}").expect("write package.json");
    fs::write(outer_nm.join("a.js"), vec![0xCCu8; 16 * 1024]).expect("write outer js");
    fs::write(nested_nm.join("b.js"), vec![0xDDu8; 16 * 1024]).expect("write nested js");

    // 4. Frontend build `.next` with sibling `package.json` -> MUST match.
    fs::create_dir_all(web_proj.join(".next/cache")).expect("create .next");
    fs::write(
        web_proj.join(".next/cache/chunk.js"),
        vec![0xEEu8; 8 * 1024],
    )
    .expect("write .next chunk");

    // 5. Xcode DerivedData -> MUST match.
    let derived = dir.path().join("Library/Developer/Xcode/DerivedData");
    fs::create_dir_all(derived.join("App-abc")).expect("create DerivedData");
    fs::write(derived.join("App-abc/build.o"), vec![0x11u8; 16 * 1024]).expect("write build.o");

    // 6. CocoaPods with Podfile -> MUST match.
    let ios_proj = dir.path().join("ios-app");
    fs::create_dir_all(ios_proj.join("Pods")).expect("create Pods");
    fs::write(ios_proj.join("Podfile"), b"platform :ios, '17.0'\n").expect("write Podfile");
    fs::write(ios_proj.join("Pods/lib.a"), vec![0x22u8; 8 * 1024]).expect("write pod lib");

    // 7. Python .venv -> MUST match.
    let py_proj = dir.path().join("ml-service");
    fs::create_dir_all(py_proj.join(".venv/lib")).expect("create .venv");
    fs::write(py_proj.join(".venv/lib/site.py"), vec![0x33u8; 8 * 1024]).expect("write py");

    let completed = run_scan_expect_completed(dir.path());
    let groups = detect_dev_artifacts(&completed.arena);

    let find_group = |id: &str| groups.iter().find(|g| g.id == id);

    // Cargo target: exactly 1 match (`my-rust-app/target`), NOT `random-folder/target`.
    let cargo_group = find_group("cargo-target").expect("cargo-target group");
    assert_eq!(cargo_group.item_count, 1);
    assert_eq!(
        cargo_group.items[0].project_name.as_deref(),
        Some("my-rust-app")
    );
    assert!(cargo_group.items[0].path.ends_with("my-rust-app/target"));

    // node_modules: exactly 1 match (nested one NOT double-counted).
    let nm_group = find_group("node-modules").expect("node-modules group");
    assert_eq!(nm_group.item_count, 1);
    assert_eq!(
        nm_group.items[0].project_name.as_deref(),
        Some("my-web-app")
    );
    assert!(nm_group.items[0].path.ends_with("my-web-app/node_modules"));

    // Frontend builds, Xcode, CocoaPods, Python all detected.
    assert_eq!(
        find_group("frontend-builds")
            .expect("frontend-builds")
            .item_count,
        1
    );
    assert_eq!(
        find_group("xcode-derived-data")
            .expect("xcode-derived-data")
            .item_count,
        1
    );
    assert_eq!(find_group("cocoapods").expect("cocoapods").item_count, 1);
    assert_eq!(
        find_group("python-envs").expect("python-envs").item_count,
        1
    );

    // Groups are sorted descending by total_physical_bytes.
    for window in groups.windows(2) {
        assert!(window[0].total_physical_bytes >= window[1].total_physical_bytes);
    }
}

#[test]
fn protected_path_guard_blocks_critical_paths_and_escapes() {
    let fake_home = PathBuf::from("/Users/testuser");
    let guard = ProtectedPathGuard::with_home(PathBuf::from("/"), Some(fake_home.clone()));

    for critical in [
        "/",
        "/System",
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
        "/System/Volumes",
        "/System/Volumes/Data",
        "/cores",
        "/opt",
        "/Users/testuser",
        "/Users/testuser/Desktop",
        "/Users/testuser/Documents",
        "/Users/testuser/Downloads",
        "/Users/testuser/Library",
        "/Users/testuser/Applications",
        "/Users/testuser/Pictures",
        "/Users/testuser/Movies",
        "/Users/testuser/Music",
    ] {
        let res = guard.validate_target(Path::new(critical));
        assert!(
            matches!(res, Err(AppError::ProtectedPath(_))),
            "expected ProtectedPath error for {critical}, got {res:?}"
        );
    }

    // Deleting a file INSIDE $HOME/Downloads is allowed when scan root covers it.
    let home_guard = ProtectedPathGuard::with_home(fake_home.clone(), Some(fake_home.clone()));
    assert!(home_guard
        .validate_target(Path::new("/Users/testuser/Downloads/installer.dmg"))
        .is_ok());

    // Deleting outside the scan root is blocked with PathOutsideScanRoot.
    let temp = TempDir::new().expect("create temp dir");
    let other = TempDir::new().expect("create other temp dir");
    let outside_file = other.path().join("secret.txt");
    fs::write(&outside_file, b"keep me").expect("write outside file");

    let scoped_guard = ProtectedPathGuard::new(temp.path().to_path_buf());
    assert!(matches!(
        scoped_guard.validate_target(&outside_file),
        Err(AppError::PathOutsideScanRoot(_))
    ));

    // Deleting the scan root itself is also blocked.
    assert!(matches!(
        scoped_guard.validate_target(temp.path()),
        Err(AppError::ProtectedPath(_))
    ));
}

#[test]
fn protected_path_guard_blocks_apfs_data_firmlink_bypasses() {
    let fake_home = PathBuf::from("/Users/testuser");
    let data_root = PathBuf::from("/System/Volumes/Data");
    let guard = ProtectedPathGuard::with_home(data_root, Some(fake_home));

    for firmlinked_critical in [
        "/System/Volumes",
        "/System/Volumes/Data",
        "/System/Volumes/Data/Users",
        "/System/Volumes/Data/Users/testuser",
        "/System/Volumes/Data/Users/testuser/Desktop",
        "/System/Volumes/Data/Users/testuser/Documents",
        "/System/Volumes/Data/Users/testuser/Downloads",
        "/System/Volumes/Data/Users/testuser/Library",
        "/System/Volumes/Data/Applications",
        "/System/Volumes/Data/Library",
    ] {
        let res = guard.validate_target(Path::new(firmlinked_critical));
        assert!(
            matches!(res, Err(AppError::ProtectedPath(_))),
            "expected ProtectedPath error for firmlinked path {firmlinked_critical}, got {res:?}"
        );
    }

    // Deleting a non-protected leaf file inside `/System/Volumes/Data` remains allowed
    // when `/System/Volumes/Data` is explicitly targeted as scan_root.
    assert!(guard
        .validate_target(Path::new(
            "/System/Volumes/Data/Users/testuser/Downloads/temp.dmg"
        ))
        .is_ok());
}

#[cfg(target_os = "macos")]
#[test]
fn protected_path_guard_enforces_case_insensitive_protection_on_macos() {
    let fake_home = PathBuf::from("/Users/testuser");
    let root_guard = ProtectedPathGuard::with_home(PathBuf::from("/"), Some(fake_home.clone()));

    for case_variant in [
        "/system",
        "/SYSTEM",
        "/applications",
        "/private/ETC",
        "/Private/Var",
        "/Users/testuser/desktop",
        "/users/TESTUSER/DOWNLOADS",
        "/system/volumes/data",
        "/system/volumes/data/users/testuser/desktop",
        "/SYSTEM/VOLUMES/DATA/Applications",
    ] {
        let res = root_guard.validate_target(Path::new(case_variant));
        assert!(
            matches!(res, Err(AppError::ProtectedPath(_))),
            "expected ProtectedPath error for case variant {case_variant}, got {res:?}"
        );
    }

    let data_guard =
        ProtectedPathGuard::with_home(PathBuf::from("/System/Volumes/Data"), Some(fake_home));
    assert!(matches!(
        data_guard.validate_target(Path::new("/system/volumes/data/users/testuser/desktop")),
        Err(AppError::ProtectedPath(_))
    ));
}

#[test]
fn protected_path_guard_blocks_intermediate_directory_symlink_escape() {
    let scan_root = TempDir::new().expect("create scan root temp dir");
    let outside = TempDir::new().expect("create outside temp dir");

    let secret_file = outside.path().join("secret.txt");
    fs::write(&secret_file, b"do not delete").expect("write outside secret");

    let symlink_dir = scan_root.path().join("link_to_outside");
    unix_fs::symlink(outside.path(), &symlink_dir).expect("create symlink to outside dir");

    let escaped_target = symlink_dir.join("secret.txt");
    let guard = ProtectedPathGuard::new(scan_root.path().to_path_buf());

    let res = guard.validate_target(&escaped_target);
    assert!(
        matches!(res, Err(AppError::PathOutsideScanRoot(_))),
        "expected PathOutsideScanRoot for intermediate symlink escape, got {res:?}"
    );
}

#[test]
fn safe_permanent_deletion_updates_disk_and_arena_with_ancestor_dedup() {
    let dir = TempDir::new().expect("create temp dir");
    let external = TempDir::new().expect("create external temp dir");
    let external_precious = external.path().join("precious.txt");
    fs::write(&external_precious, b"must survive").expect("write external file");

    let removable_dir = dir.path().join("reclaimable");
    fs::create_dir(&removable_dir).expect("create removable dir");
    let nested_file = removable_dir.join("big.bin");
    fs::write(&nested_file, vec![0x77u8; 64 * 1024]).expect("write big.bin");

    let keep_file = dir.path().join("keep.bin");
    fs::write(&keep_file, vec![0x88u8; 16 * 1024]).expect("write keep.bin");

    // Leaf symlink pointing to external precious file.
    let link_path = dir.path().join("external_link");
    unix_fs::symlink(&external_precious, &link_path).expect("create leaf symlink");

    let mut completed = run_scan_expect_completed(dir.path());
    let arena = &mut completed.arena;

    let removable_id = find_node_by_name(arena, "reclaimable").expect("removable dir node");
    let nested_id = find_node_by_name(arena, "big.bin").expect("nested file node");
    let link_id = find_node_by_name(arena, "external_link").expect("symlink node");
    let keep_id = find_node_by_name(arena, "keep.bin").expect("keep file node");
    let keep_phys = arena.nodes[keep_id].physical_bytes;
    let removable_phys = arena.nodes[removable_id].physical_bytes;

    // Pass BOTH ancestor `removable_id` and descendant `nested_id`, plus the leaf symlink.
    let request = DeleteRequest {
        node_ids: vec![
            node_id_to_key(removable_id),
            node_id_to_key(nested_id),
            node_id_to_key(link_id),
        ],
        mode: DeleteMode::Permanent,
    };

    let result = delete_nodes(arena, request).expect("delete_nodes succeeds");

    assert!(
        result.failures.is_empty(),
        "unexpected failures: {:?}",
        result.failures
    );
    // Ancestor deduplication means `removable_id` and `link_id` were executed (2 targets).
    assert_eq!(result.deleted_node_ids.len(), 2);
    assert_eq!(result.reclaimed_physical_bytes, removable_phys);

    // Disk verification: removed targets gone, keep file and symlink's external target untouched!
    assert!(!removable_dir.exists());
    assert!(!link_path.exists());
    assert!(keep_file.exists());
    assert!(
        external_precious.exists(),
        "deleting a leaf symlink must NEVER delete its external target"
    );

    // Arena verification: removed keys freed, root stats updated accurately in O(depth).
    assert!(!arena.nodes.contains_key(removable_id));
    assert!(!arena.nodes.contains_key(nested_id));
    assert!(!arena.nodes.contains_key(link_id));
    assert!(arena.nodes.contains_key(keep_id));

    let updated_root = result.updated_root.expect("updated root summary");
    assert_eq!(updated_root.physical_bytes, keep_phys);
    assert_eq!(updated_root.file_count, 1);
    assert_eq!(updated_root.dir_count, 0);
}

#[test]
fn scanner_respects_cancel_flag() {
    let dir = TempDir::new().expect("create temp dir");
    fs::write(dir.path().join("a.txt"), b"hello").expect("write file");

    let cancel = Arc::new(AtomicBool::new(true));
    let outcome = scan_directory(42, dir.path(), cancel, |_| {}).expect("scan returns ok");
    assert!(matches!(outcome, ScanOutcome::Cancelled { .. }));
}

#[test]
fn macos_disk_overview_and_fda_probe_smoke_tests() {
    let overview = get_disk_overview(Some(Path::new("/"))).expect("statvfs on /");
    assert!(overview.total_bytes > 0);
    assert!(!overview.volume_name.is_empty());
    assert!(overview.used_bytes <= overview.total_bytes);

    let fda = probe_full_disk_access();
    assert_eq!(fda.settings_url, FDA_SETTINGS_URL);
    assert!(!fda.probed_path.is_empty());

    // Sanity check category classifier.
    assert_eq!(classify_category("src", true), FileCategory::Directory);
    assert_eq!(classify_category("main.rs", false), FileCategory::Code);
    assert_eq!(classify_category("video.mov", false), FileCategory::Media);
    assert_eq!(
        classify_category("backup.tar.gz", false),
        FileCategory::Archive
    );
    assert_eq!(
        classify_category("Docker.raw", false),
        FileCategory::DiskImage
    );
    assert_eq!(
        classify_category("report.pdf", false),
        FileCategory::Document
    );
    assert_eq!(classify_category(".DS_Store", false), FileCategory::System);
}
