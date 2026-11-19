# Frontend Rules (`src/`)

- **Stack:** React 19, strict TypeScript (`pnpm tsc --noEmit`), Tailwind CSS v4, `pnpm` exclusively.
- **Canvas-Only Visualization:** Treemap and Sunburst cells MUST render on HTML5 `<canvas>` using `d3-hierarchy` layouts with HiDPI `devicePixelRatio` scaling and dirty-flag redraws. Never create per-node DOM or SVG elements.
- **Virtualized Lists:** Directory listings MUST use `@tanstack/react-virtual` to stay fluid at 100k+ entries.
- **IPC Dual Mode:** All backend calls go through `src/lib/ipc/client.ts` (live Tauri v2 when `__TAURI_INTERNALS__` exists; deterministic `MockIpcClient` otherwise).
- **Safe Deletion UX:** `DeleteConfirmModal` defaults to `"trash"` (Finder Trash) every time it opens and requires explicit opt-in + acknowledgment before permanent deletion.
- **Accessibility & Modern Web:** Follow `modern-web-guidance` for focus management, semantic dialogs/landmarks, keyboard navigation, and Light/Dark macOS styling.
