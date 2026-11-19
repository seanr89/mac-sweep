---
name: tauri-ipc-contracts
description: >-
  Contract management runbook for Tauri v2 Commands, streaming Channels,
  and Rust-to-TypeScript DTO parity in mac-sweep. Use whenever adding,
  changing, or wiring IPC commands, events, error types, or mock fixtures.
---

# Tauri v2 IPC Contract Runbook

## 1. Single Source of Truth
These three locations MUST stay 100% synchronized:
1. `docs/ipc-contract.md` — Human-readable contract specification.
2. `src-tauri/src/ipc/types.rs` — Rust `serde` DTOs (`#[serde(rename_all = "camelCase")]`).
3. `src/lib/ipc/types.ts` — Strict TypeScript interfaces.

## 2. NodeKey Encoding (`SlotMap` -> JSON)
`SlotMap`'s `KeyData::as_ffi()` returns a `u64` whose upper 32 bits carry the generation version. Passing it as a JSON number loses precision in JavaScript (`Number.MAX_SAFE_INTEGER` is 2^53 - 1).
- **Rule:** Always serialize `NodeId` as a decimal `String` (`NodeKey = string` in TypeScript).
- Helper functions in Rust:
  - `node_id_to_key(id: NodeId) -> String`: `id.data().as_ffi().to_string()`
  - `key_to_node_id(key: &str) -> Result<NodeId, AppError>`: `key.parse::<u64>().map(|v| NodeId::from(KeyData::from_ffi(v)))`

## 3. Streaming Scan Events (`Channel<ScanEvent>`)
- Use `tauri::ipc::Channel<ScanEvent>` as an argument to `start_scan`.
- Rust enum tags MUST use `#[serde(tag = "type", rename_all = "camelCase")]`.
- Throttle `ScanEvent::Progress` emissions to at most once every 75ms (`Instant::now().duration_since(last_emit) >= Duration::from_millis(75)`). Never send an event per file.

## 4. Error Serialization
- Define `AppError` with `thiserror::Error` and implement `serde::Serialize` serializing as a structured object `{ code: string, message: string }` or descriptive string, consistently handled in `src/lib/ipc/client.ts`.
- Never call `.unwrap()` or `.expect()` inside `#[tauri::command]` handlers.

## 5. Dual-Mode Frontend Client
`src/lib/ipc/client.ts` MUST detect Tauri runtime via `typeof window !== "undefined" && "__TAURI_INTERNALS__" in window`:
- Inside Tauri: invoke real `@tauri-apps/api/core` `invoke()` and `Channel`.
- Outside Tauri (Vite dev preview / Vitest): delegate seamlessly to `MockIpcClient` backed by `src/lib/ipc/mockData.ts`.

## 6. Validation
After any IPC change, verify both sides compile cleanly:
```bash
cd src-tauri && cargo check
pnpm tsc --noEmit
```
