# Architecture & Design Specification: `disk-dive` (macOS)

## 1. Executive Summary
`disk-dive` is a high-performance, native-feeling macOS desktop application designed to scan local storage at near-disk-controller speeds, visualize directory hierarchies interactively, and safely reclaim disk space. 

To balance raw I/O throughput with rich, fluid data visualizations, the application uses a **Rust core** paired with a **Tauri v2** shell and a **React + TypeScript** visualization client.

---

## 2. Technology Stack

| Layer | Technology | Rationale |
| :--- | :--- | :--- |
| **Desktop Shell & IPC** | **Tauri v2** | Uses macOS `WKWebView` (~10–15 MB RAM overhead vs. Electron's ~150 MB+) with native macOS menu bars, vibrancy effects, and typed IPC channels. |
| **Core Engine** | **Rust (2021 Edition)** | Zero-cost abstractions, fearless concurrency, and direct POSIX/macOS syscall access (`libc`) for maximum filesystem traversal speed. |
| **Parallel Traversal** | **`rayon` + `jwalk`** | Work-stealing thread pool optimized for concurrent `readdir` / `fstatat` metadata queries. |
| **Arena Memory** | **`slotmap` or `id_tree`** | Contiguous arena allocation for millions of file nodes, avoiding `Arc<Mutex<T>>` pointer-chasing overhead and enabling instant subtree deletion. |
| **Frontend UI** | **React 19, TypeScript, Tailwind CSS** | Fast component state management and clean native-styled utility layouts. |
| **Visualization** | **HTML5 Canvas / D3-Hierarchy** | Custom Canvas-rendered **Squarified Treemap** and **Zoomable Sunburst** capable of rendering 50,000+ visible rectangles at 60fps without DOM bloat. |
| **Safe Deletion** | **`trash` crate** | Moves deleted items to the macOS Finder Trash (`NSFileManager.trashItemAtURL`) by default, with optional permanent `rm -rf` bypass. |

---

## 3. macOS & APFS Engineering Considerations

Building an accurate disk analyzer on macOS requires handling specific Apple File System (APFS) behaviors:

1. **Physical vs. Logical Size (`st_blocks` vs. `st_size`)**
   * Sparse files (e.g., Docker `.raw` disk images, VM images) report massive logical sizes (`st_size`) while occupying minimal physical blocks.
   * **Rule:** Always calculate actual disk consumption using `metadata.blocks() * 512` (allocated physical bytes) as the primary metric, displaying logical size as secondary metadata.
2. **APFS Firmlinks & Double-Counting**
   * macOS Catalina+ splits the OS into a read-only system volume and `/System/Volumes/Data`, joined via firmlinks (e.g., `/Users` points to `/System/Volumes/Data/Users`).
   * **Rule:** Restrict root `/` scans to the active data mount or explicitly skip `/System/Volumes/Data` (and `/dev`, `/Volumes` network mounts) to prevent counting the entire user filesystem twice.
3. **Hard Link Deduplication**
   * Track `(st_dev, st_ino)` pairs in a concurrent `DashSet` for files where `st_nlink > 1`. Only count the physical block size on the first encounter to avoid inflating totals on Time Machine local snapshots or Homebrew hard-linked cellars.
4. **Full Disk Access (FDA) & TCC Permissions**
   * Scanning `~/Library/Mail`, `~/Library/Messages`, or `/Library` triggers macOS Transparency, Consent, and Control (TCC) prompts or `EPERM` errors.
   * **Rule:** On startup, probe a protected path (e.g., `~/Library/Safari`). If `PermissionDenied`, display a non-blocking banner with a deep-link button triggering `open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"`.

---

## 4. System Architecture

```text
+-------------------------------------------------------------------+
|                        Frontend (WKWebView)                       |
|  +-----------------------+  +----------------------------------+  |
|  |  Interactive Canvas   |  |   Directory Tree & Dev Presets   |  |
|  | (Sunburst / Treemap)  |  |  (Virtualized List + Action Bar) |  |
|  +-----------+-----------+  +----------------+-----------------+  |
|              |                               |                    |
|              +---------------+---------------+                    |
|                              | Tauri IPC (Commands & Channels)    |
+------------------------------+------------------------------------+
                               |
+------------------------------+------------------------------------+
|                         Rust Core Engine                          |
|  +-----------------------+  +----------------------------------+  |
|  |  Parallel Scanner     |  |       In-Memory Arena Tree       |  |
|  |  (Rayon + libc stat)  |->|   (SlotMap<NodeId, FileNode>)    |  |
|  +-----------------------+  +----------------+-----------------+  |
|                                              |                    |
|  +-----------------------+  +----------------v-----------------+  |
|  |   Artifact Detector   |  |         Cleanup Executor         |  |
|  | (node_modules, etc.)  |  |  (Finder Trash / Permanent rm)   |  |
|  +-----------------------+  +----------------------------------+  |
+-------------------------------------------------------------------+