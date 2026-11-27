# Changelog

All notable changes to Mac Sweep will be documented in this file.

## [0.1.0](https://github.com/seanr89/mac-sweep/releases/tag/v0.1.0) (2026-11-24)

### Features

* Parallel APFS filesystem scanner with physical block sizing, firmlink exclusions, hard-link deduplication, and Full Disk Access detection
* Interactive 60fps HTML5 Canvas Squarified Treemap and Zoomable Sunburst visualizations
* Virtualized directory explorer and Developer Artifact cleanup presets
* Safe Finder Trash deletion workflow with `ProtectedPathGuard` and instant arena updates
* Automated release versioning, bundled in-app changelog, and About screen

### Bug Fixes

* **cleanup:** use `NSFileManager.trashItemAtURL` and handle iCloud dataless trash failures
