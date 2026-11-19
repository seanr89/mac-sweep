# `mac-sweep` Repository Guide

`mac-sweep` is a native-feeling macOS disk-space analyzer and cleanup desktop app built with **Tauri v2**, **Rust (2021 Edition)**, **React 19**, **TypeScript**, **Tailwind CSS v4**, and **HTML5 Canvas (`d3-hierarchy`)**.

See [arch.md](./arch.md) for the high-level architecture and [docs/ipc-contract.md](./docs/ipc-contract.md) for the Rust ↔ TypeScript IPC specification.

## Workspace Plugin & Specialist Subagents
Project skills, rules, and specialist agents are bundled in `.agents/plugins/mac-sweep-dev/`:
- **`ipc-architect`**: Tauri config, capabilities, Rust/TS IPC contract (`src-tauri/src/ipc/types.rs`, `src/lib/ipc/types.ts`, `docs/ipc-contract.md`).
- **`rust-core-engineer`**: `src-tauri/src/` (APFS scanner, `SlotMap` arena, artifact detector, safe cleanup, Tauri commands).
- **`canvas-viz-engineer`**: `src/lib/viz/` and `src/components/viz/` (60fps Canvas Treemap & Zoomable Sunburst).
- **`ui-shell-engineer`**: `src/store/`, `src/lib/ipc/client.ts`, `src/components/{layout,tree,presets,modals}/`, `src/App.tsx`.
- **`macos-qa-auditor`**: Independent verification, safety audit, and regression testing.

## Quick Commands
- Install deps: `pnpm install`
- Dev app (macOS): `pnpm tauri dev`
- Rust checks: `cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`
- Frontend checks: `pnpm tsc --noEmit && pnpm test && pnpm build`
- Desktop compile check: `pnpm tauri build --debug --no-bundle`
