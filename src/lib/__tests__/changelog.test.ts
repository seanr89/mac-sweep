import { describe, expect, it } from "vitest";
import releaseManifest from "../../../.release-please-manifest.json";
import packageJson from "../../../package.json";
import rawCargoToml from "../../../src-tauri/Cargo.toml?raw";
import tauriConf from "../../../src-tauri/tauri.conf.json";
import {
  APP_FALLBACK_VERSION,
  BUNDLED_CHANGELOG_ENTRIES,
  getLatestChangelogEntry,
  parseChangelog,
} from "../changelog";

describe("changelog parser", () => {
  it("parses release-please formatted releases with commit link stripping", () => {
    const md = `# Changelog

## [0.2.0](https://github.com/seanr89/mac-sweep/compare/v0.1.0...v0.2.0) (2026-12-01)

### Features

* add automated release workflow ([abc1234](https://github.com/seanr89/mac-sweep/commit/abc1234))
* **ui:** add About dialog ([#12](https://github.com/seanr89/mac-sweep/issues/12)) ([def5678](https://github.com/seanr89/mac-sweep/commit/def5678))

### Bug Fixes

* **cleanup:** guard symlinks ([111aaaa](https://github.com/seanr89/mac-sweep/commit/111aaaa))

## [0.1.0](https://github.com/seanr89/mac-sweep/releases/tag/v0.1.0) (2026-11-24)

### Features

* initial release
`;

    const entries = parseChangelog(md);
    expect(entries).toHaveLength(2);

    expect(entries[0]).toEqual({
      version: "0.2.0",
      date: "2026-12-01",
      url: "https://github.com/seanr89/mac-sweep/compare/v0.1.0...v0.2.0",
      sections: [
        {
          title: "Features",
          items: [
            "add automated release workflow",
            "**ui:** add About dialog",
          ],
        },
        {
          title: "Bug Fixes",
          items: ["**cleanup:** guard symlinks"],
        },
      ],
    });

    expect(entries[1]?.version).toBe("0.1.0");
    expect(entries[1]?.date).toBe("2026-11-24");
  });

  it("parses Keep a Changelog, Unreleased, and bullets without subsections", () => {
    const md = `# Changelog

## [Unreleased]

- upcoming improvement without subsection

## [0.3.0] - 2026-12-15

### Added

- support external volumes
`;

    const entries = parseChangelog(md);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      version: "Unreleased",
      date: null,
      url: null,
      sections: [
        {
          title: "Changes",
          items: ["upcoming improvement without subsection"],
        },
      ],
    });
    expect(entries[1]).toEqual({
      version: "0.3.0",
      date: "2026-12-15",
      url: null,
      sections: [
        {
          title: "Added",
          items: ["support external volumes"],
        },
      ],
    });
  });

  it("resolves latest changelog entry matching currentVersion or falls back to first", () => {
    const entries = parseChangelog(`
## [0.2.0] (2026-12-01)
### Features
* second

## [0.1.0] (2026-11-24)
### Features
* first
`);

    expect(getLatestChangelogEntry(entries, "0.1.0")?.version).toBe("0.1.0");
    expect(getLatestChangelogEntry(entries, "v0.1.0")?.version).toBe("0.1.0");
    expect(getLatestChangelogEntry(entries, "9.9.9")?.version).toBe("0.2.0");
    expect(getLatestChangelogEntry([], "0.1.0")).toBeNull();
  });

  it("bundles non-empty entries from root CHANGELOG.md", () => {
    expect(BUNDLED_CHANGELOG_ENTRIES.length).toBeGreaterThan(0);
    const current = getLatestChangelogEntry(
      BUNDLED_CHANGELOG_ENTRIES,
      APP_FALLBACK_VERSION,
    );
    expect(current).not.toBeNull();
    expect(current?.version).toBe(APP_FALLBACK_VERSION);
    expect(current?.sections.length).toBeGreaterThan(0);
  });

  it("keeps versions synchronized across package.json, tauri.conf.json, Cargo.toml, and release-please manifest", () => {
    const cargoVersionMatch = rawCargoToml.match(
      /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m,
    );
    const cargoVersion = cargoVersionMatch?.[1];

    expect(cargoVersion).toBeDefined();
    expect(packageJson.version).toBe(tauriConf.version);
    expect(packageJson.version).toBe(cargoVersion);
    expect(packageJson.version).toBe(releaseManifest["."]);
  });
});
