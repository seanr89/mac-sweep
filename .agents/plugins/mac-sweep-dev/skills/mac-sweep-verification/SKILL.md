---
name: mac-sweep-verification
description: >-
  End-to-end verification and audit runbook for mac-sweep covering Rust
  clippy/fmt/tests, TypeScript strict checks, Vitest unit & 50k-node perf
  tests, Vite production build, and Tauri macOS binary verification.
---

# Mac Sweep Verification Runbook

Run these checks in order after each integration milestone and during Wave 4 QA audit.

## 1. Rust Core Verification
```bash
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test -- --nocapture
```
Confirm tests explicitly pass for:
- Sparse file (`physical_bytes` << `logical_bytes`)
- Hard-link deduplication (counted once, duplicates flagged)
- Symlink cycle immunity
- APFS firmlink & `/Volumes` exclusion policy
- `SlotMap` O(depth) subtree deletion & ancestor re-aggregation
- Dev Artifact Detector (including Cargo.toml sibling check and no nested double-count)
- `ProtectedPathGuard` blocklist & safe temp deletion

## 2. Frontend Type Safety, Tests & Build
```bash
pnpm tsc --noEmit
pnpm test
pnpm build
```
Confirm Vitest covers:
- Squarified Treemap layout, culling, hit-testing, and 50,000-node latency budget
- Zoomable Sunburst polar layout, center hub, and hit-testing
- Zustand store scan/drill-down/delete flows
- `DeleteConfirmModal` safe-default & permanent-delete confirmation guardrails

## 3. IPC Contract Parity Audit
Compare `src-tauri/src/ipc/types.rs`, `src/lib/ipc/types.ts`, and `docs/ipc-contract.md`:
- Every `#[tauri::command]` name and parameter matches `src/lib/ipc/client.ts`.
- Every `#[serde(rename_all = "camelCase")]` field name matches its TypeScript property exactly.
- `NodeId` is serialized as stringified `u64` everywhere (`NodeKey = string`).

## 4. Tauri macOS Binary Compilation Check
```bash
pnpm tauri build --debug --no-bundle
```
Verify exit code 0 and zero compiler warnings.
