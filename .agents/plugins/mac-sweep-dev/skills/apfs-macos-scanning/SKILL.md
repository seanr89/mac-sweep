---
name: apfs-macos-scanning
description: >-
  Authoritative macOS and APFS filesystem scanning runbook for mac-sweep.
  Use when implementing, modifying, or testing parallel directory traversal,
  physical vs logical size calculation, APFS firmlink/mount exclusions,
  hard-link deduplication, or Full Disk Access (TCC) probing.
---

# macOS & APFS Scanning Runbook

Follow these exact rules when working on `src-tauri/src/scanner/` or `src-tauri/src/macos/`.

## 1. Physical vs. Logical Size
Always import `std::os::unix::fs::MetadataExt`:
- `let physical_bytes = meta.blocks().saturating_mul(512);`
- `let logical_bytes = meta.size();`
- Never use `meta.len()` as the primary disk usage figure—sparse files (Docker `.raw`, VM images) report multi-GB logical sizes while consuming near-zero physical blocks.

## 2. APFS Firmlink & Virtual Mount Exclusion
On macOS Catalina+, `/` is a sealed read-only system volume firmlinked to `/System/Volumes/Data` (`/Users`, `/Applications`, `/Library`, `/opt`, `/usr/local`).
Implement `should_skip_path(path: &Path, scan_root: &Path) -> bool`:
1. Skip `/System/Volumes/Data` unless `scan_root` starts with `/System/Volumes/Data`.
2. Always skip `/dev`, `/net`, `/home`, `/.vol`.
3. Skip `/Volumes` when `scan_root == Path::new("/")` (or is an ancestor of `/Volumes`) so external/network mounts aren't pulled into a root disk scan; **allow** scanning when the user explicitly selects `/Volumes/<SomeDrive>`.
4. Apply `should_skip_path` inside `jwalk`'s `process_read_dir` callback so pruned mounts are never descended into.

## 3. Hard-Link Deduplication
- Maintain `seen_hardlinks: Arc<DashSet<(u64, u64)>>`.
- For non-directory entries where `meta.nlink() > 1`:
  - Call `seen_hardlinks.insert((meta.dev(), meta.ino()))`.
  - If `false` (already counted): set `physical_bytes = 0`, `is_hardlink_dup = true`, and increment `hardlinks_deduplicated` counter.
  - Keep `logical_bytes` intact for inspection metadata, but do NOT add duplicate `physical_bytes` to parent totals.

## 4. Parallel Traversal & Cancellation
- Use `jwalk::WalkDirGeneric` with `follow_links(false)` and `skip_hidden(false)`.
- Check `cancel_flag.load(Ordering::Relaxed)` in `process_read_dir` and the collection loop to abort promptly.
- Catch `ErrorKind::PermissionDenied` (`EPERM` / `EACCES`) on directories/entries, record `permission_denied = true` on the node (or increment `permission_errors`), and continue scanning without failing the entire run.

## 5. Full Disk Access (FDA) & TCC Probe
- Probe `~/Library/Safari` with `std::fs::read_dir` (fallback to `~/Library/Mail` if `Safari` returns `NotFound`).
- `PermissionDenied` => `FdaStatus { granted: false, probed_path }`.
- `Ok(_)` => `FdaStatus { granted: true, probed_path }`.
- Deep-link command: `std::process::Command::new("/usr/bin/open").arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")`.

## 6. Mandatory Unit Test Fixtures
Every change to the scanner must pass tests covering:
1. **Sparse file:** `File::create` + `file.set_len(64 * 1024 * 1024)` (64 MiB logical, ~0 physical blocks on APFS).
2. **Hard links:** Write 64 KiB payload + `std::os::unix::fs::hard_link` twice -> total physical bytes counted once, 2 duplicates flagged.
3. **Symlink loop:** Symlink pointing back to parent directory -> scan completes without panic or infinite recursion.
4. **Firmlink & `/Volumes` policy:** Direct unit tests on `should_skip_path`.
