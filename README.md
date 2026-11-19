# mac-sweep

Native macOS disk-space visualization and safe cleanup desktop application built with Tauri v2, Rust (2021 Edition), React 19, TypeScript, Tailwind CSS v4, and 60fps HTML5 Canvas (`d3-hierarchy`).

## Quick Start (`Makefile`)

```bash
make deps          # Install frontend dependencies via pnpm
make dev           # Launch Mac Sweep in Tauri hot-reload dev mode
make build         # Build production frontend + debug Tauri binary
make release       # Build optimized macOS .app bundle into ./release/
make release-dmg   # Build both .app bundle and .dmg installer into ./release/
make run           # Run the staged executable directly from ./release/Mac Sweep.app/Contents/MacOS/mac-sweep
make run-app       # Open the staged ./release/Mac Sweep.app bundle via macOS LaunchServices
make install       # Copy staged Mac Sweep.app to ~/Applications (override with INSTALL_DIR=/Applications)
make check         # Run cargo fmt, cargo clippy -D warnings, and pnpm tsc --noEmit
make test          # Run Rust and Vitest test suites
make clean         # Remove dist/, release/, and src-tauri/target/
```

Override the staged output location at any time with `RELEASE_DIR`:

```bash
make release RELEASE_DIR=./build/release
make run RELEASE_DIR=./build/release
```
