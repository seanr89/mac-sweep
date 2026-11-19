# Mac Sweep Core Engineering Rules

These invariants apply across the entire `mac-sweep` codebase and must never be violated.

## 1. APFS & macOS Accuracy Invariants
- **Physical Size First:** Always compute actual disk consumption via `std::os::unix::fs::MetadataExt::blocks().saturating_mul(512)` (allocated 512-byte blocks). Expose `logical_bytes` (`metadata.size()`) as secondary metadata so sparse files (e.g., Docker `.raw`, VM images) are never misrepresented.
- **APFS Firmlink & Mount Safety:** When scanning `/` (or ancestors of `/System/Volumes/Data`), explicitly skip `/System/Volumes/Data`, `/dev`, `/net`, `/home`, `/.vol`, and `/Volumes` (unless the user explicitly selected a target inside `/Volumes/<volume>`). Never double-count the macOS Data volume.
- **Hard-Link Deduplication:** For non-directory entries with `metadata.nlink() > 1`, track `(metadata.dev(), metadata.ino())` in a concurrent `DashSet<(u64, u64)>`. Count `physical_bytes` only on the first encounter; mark duplicates `is_hardlink_dup = true` with `physical_bytes = 0`.
- **Symlink Discipline:** Always use `symlink_metadata()` (`lstat`) and `follow_links(false)` during traversal and deletion so symlink cycles never loop and symlink targets are never double-counted or deleted.
- **Full Disk Access (FDA):** Probe a TCC-protected path (`~/Library/Safari`, fallback `~/Library/Mail`) on startup without blocking the UI. Surface a non-blocking banner with the deep link `x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles`.

## 2. Memory & Performance Invariants
- **Arena Allocation:** Store the scanned tree in a contiguous `SlotMap<NodeId, FileNode>`. Store only the filename segment (`Box<str>`) per node and reconstruct full paths by walking `parent` pointers on demand.
- **Canvas-Only Visualization:** Treemap and Sunburst views MUST render via HTML5 `<canvas>` (never per-node DOM elements or SVG nodes) to sustain 60fps at 50,000+ nodes.
- **Throttled Streaming IPC:** Stream scan progress over Tauri v2 `Channel<ScanEvent>` at 50–100ms intervals—never emit per-file IPC messages.

## 3. Safe Deletion Invariants
- **Finder Trash by Default:** Every cleanup flow defaults to `trash::delete` (`NSFileManager.trashItemAtURL`).
- **Protected Path Guard:** `ProtectedPathGuard` MUST block deletion of `/`, `/System`, `/Applications`, `/Users`, `/Library`, `/usr`, `/bin`, `/sbin`, `/private`, `/etc`, `/var`, `$HOME` itself, or any path outside the active scan root—for both Trash and Permanent modes.
- **Instant Arena Update:** After disk deletion succeeds, remove the subtree from `SlotMap` and propagate decrements up the ancestor chain in O(depth) without triggering a rescan.

## 4. Contract & Tooling Invariants
- **IPC Single Source of Truth:** `src-tauri/src/ipc/types.rs`, `src/lib/ipc/types.ts`, and `docs/ipc-contract.md` must remain strictly aligned. Serialize `SlotMap` `NodeId` (`u64` FFI key) as a decimal string (`NodeKey = string`) to prevent JS 53-bit precision loss.
- **Tooling:** Rust **2021 Edition** (`cargo clippy --all-targets -- -D warnings` must pass cleanly); frontend uses **`pnpm`** exclusively with React 19, strict TypeScript, and Tailwind CSS v4.
