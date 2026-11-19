---
name: safe-cleanup-guardrails
description: >-
  Safety checklist and implementation standard for filesystem deletion,
  Finder Trash integration, ProtectedPathGuard, and post-delete arena
  updates in mac-sweep. Use whenever touching cleanup logic or deletion UI.
---

# Safe Cleanup Guardrails

Disk cleanup tools carry irreversible data-loss risk. Every layer MUST enforce defense-in-depth.

## 1. Backend `ProtectedPathGuard` (`src-tauri/src/cleanup/executor.rs`)
Before deleting ANY path (whether Trash or Permanent):
1. Resolve the node's path from `ArenaTree` (never trust raw arbitrary path strings from the frontend—accept only `NodeKey` IDs belonging to the active scanned arena!).
2. Verify the target is strictly inside `arena.root_path` (never equal to `arena.root_path` if `root_path` is protected or `/`).
3. Canonicalize parent/target safely (without following a leaf symlink!) and reject if the target matches any protected path:
   - `/`, `/System`, `/Applications`, `/Users`, `/Library`, `/usr`, `/bin`, `/sbin`, `/private`, `/etc`, `/var`, `/Volumes`, `/cores`, `/opt`
   - The current user's `$HOME` directory itself (e.g. `/Users/<name>`)
   - Critical top-level user directories: `$HOME/Desktop`, `$HOME/Documents`, `$HOME/Downloads`, `$HOME/Library`, `$HOME/Applications`, `$HOME/Pictures`, `$HOME/Movies`, `$HOME/Music`
   (Deleting *files/subfolders inside* `$HOME/Downloads` or `$HOME/Library/Developer/Xcode/DerivedData` IS allowed; deleting those root directories themselves is blocked.)

## 2. Deletion Semantics
- **Default (`DeleteMode::Trash`):** Call `trash::delete(&path)` which routes to macOS `NSFileManager.trashItemAtURL` (recoverable via Finder Trash).
- **Permanent (`DeleteMode::Permanent`):**
  - Check `std::fs::symlink_metadata(&path)`:
    - If `is_symlink()` or `is_file()`: `std::fs::remove_file(&path)`.
    - If `is_dir()`: `std::fs::remove_dir_all(&path)`.
  - Never follow symlinks during removal.
- **Ancestor Pruning:** If the request contains both a directory and one of its descendants, deduplicate/skip the descendant so only the top-most target is deleted once.

## 3. Instant In-Memory Arena Sync
Immediately after each successful on-disk deletion:
- Call `arena.remove_subtree(node_id)`.
- Verify all descendants are removed from `SlotMap` and ancestors' `physical_bytes`, `logical_bytes`, and `file_count` are decremented accurately in O(depth).

## 4. Frontend Deletion UX Guardrails (`DeleteConfirmModal.tsx`)
- Always reset modal state to `mode = "trash"` every time it opens.
- Permanent deletion requires the user to explicitly toggle **"Delete Permanently (Bypass Trash)"**, displays a high-contrast danger warning, and requires checking an explicit acknowledgment checkbox before enabling the destructive button.
- Show exact item count, total reclaimable physical bytes, and preview paths before execution.
