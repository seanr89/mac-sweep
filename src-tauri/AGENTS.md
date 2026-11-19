# Rust Core Engine Rules (`src-tauri/`)

- **Edition & Hygiene:** Target Rust 2021 Edition. `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` must pass cleanly.
- **No Panics in Commands:** Never use `.unwrap()` or `.expect()` in `#[tauri::command]` handlers or filesystem walkers; propagate typed `AppError` or record per-node `permission_denied`.
- **APFS Accuracy:** Primary disk usage is ALWAYS `metadata.blocks().saturating_mul(512)`. Track `metadata.size()` separately as `logical_bytes`. Deduplicate hard links (`nlink > 1`) via `(dev, ino)` in a `DashSet`. Skip `/System/Volumes/Data` (unless explicitly scanned), `/dev`, `/net`, `/home`, `/.vol`, and `/Volumes` on root `/` scans.
- **Arena Memory Discipline:** Store only filename segments (`Box<str>`) per `FileNode` in `SlotMap<NodeId, FileNode>`; reconstruct full paths by walking `parent` links. Serialize `NodeId` as decimal string (`id.data().as_ffi().to_string()`).
- **Safe Deletion:** Always validate via `ProtectedPathGuard` before calling `trash::delete` or permanent removal. Never follow symlinks when deleting. Always call `arena.remove_subtree(id)` immediately after successful deletion.
