import rawChangelog from "../../CHANGELOG.md?raw";
import packageJson from "../../package.json";

export const APP_FALLBACK_VERSION: string = packageJson.version;

export interface ChangelogSection {
  title: string;
  items: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string | null;
  url: string | null;
  sections: ChangelogSection[];
}

const RELEASE_HEADING_RE =
  /^##\s+(?:\[([^\]]+)\](?:\(([^)]+)\))?|([^\s(]+))(?:\s*(?:\((\d{4}-\d{2}-\d{2})\)|-\s*(\d{4}-\d{2}-\d{2})))?/;
const SECTION_HEADING_RE = /^###\s+(.+)$/;
const BULLET_LINE_RE = /^[-*]\s+(.+)$/;
const TRAILING_COMMIT_LINK_RE =
  /\s*\(\[[0-9a-f]{7,40}\]\([^)]+\)\)\s*$/i;
const TRAILING_PR_LINK_RE =
  /\s*\(\[#\d+\]\([^)]+\)\)(?=\s*$|\s*\(\[[0-9a-f]{7,40}\])/i;

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

function cleanBulletItem(raw: string): string {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(TRAILING_COMMIT_LINK_RE, "");
  cleaned = cleaned.replace(TRAILING_PR_LINK_RE, "");
  cleaned = cleaned.replace(TRAILING_COMMIT_LINK_RE, "");
  return cleaned.trim();
}

/**
 * Parse a `release-please` or Keep a Changelog formatted `CHANGELOG.md` into
 * structured version entries grouped by release and section.
 */
export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let currentEntry: ChangelogEntry | null = null;
  let currentSection: ChangelogSection | null = null;

  const lines = markdown.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const releaseMatch = line.match(RELEASE_HEADING_RE);
    if (releaseMatch) {
      const rawVersion = releaseMatch[1] ?? releaseMatch[3] ?? "";
      const url = releaseMatch[2] ?? null;
      const date = releaseMatch[4] ?? releaseMatch[5] ?? null;

      currentEntry = {
        version: rawVersion.trim(),
        date,
        url,
        sections: [],
      };
      entries.push(currentEntry);
      currentSection = null;
      continue;
    }

    if (!currentEntry) {
      continue;
    }

    const sectionMatch = line.match(SECTION_HEADING_RE);
    if (sectionMatch?.[1]) {
      currentSection = {
        title: sectionMatch[1].trim(),
        items: [],
      };
      currentEntry.sections.push(currentSection);
      continue;
    }

    const bulletMatch = line.match(BULLET_LINE_RE);
    if (bulletMatch?.[1]) {
      const text = cleanBulletItem(bulletMatch[1]);
      if (!text) {
        continue;
      }
      if (!currentSection) {
        currentSection = {
          title: "Changes",
          items: [],
        };
        currentEntry.sections.push(currentSection);
      }
      currentSection.items.push(text);
    }
  }

  return entries;
}

/**
 * Return the changelog entry matching `currentVersion` (ignoring a leading `v`),
 * falling back to the first entry in `entries`.
 */
export function getLatestChangelogEntry(
  entries: ChangelogEntry[],
  currentVersion?: string,
): ChangelogEntry | null {
  if (entries.length === 0) {
    return null;
  }

  if (currentVersion) {
    const target = normalizeVersion(currentVersion);
    const exact = entries.find(
      (entry) => normalizeVersion(entry.version) === target,
    );
    if (exact) {
      return exact;
    }
  }

  return entries[0] ?? null;
}

export const BUNDLED_CHANGELOG_ENTRIES: ChangelogEntry[] =
  parseChangelog(rawChangelog);
