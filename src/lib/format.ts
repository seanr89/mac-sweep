/**
 * macOS Finder-aligned decimal (SI base-1000) formatting utilities and
 * APFS storage heuristics for Mac Sweep.
 */

const DECIMAL_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;
const DECIMAL_BASE = 1000;

const COUNT_FORMATTER = new Intl.NumberFormat("en-US");

/**
 * Format a byte count using macOS Finder decimal units (base-1000: B, KB, MB, GB, TB).
 * Defaults to clean adaptive decimal places suitable for tabular alignment.
 */
export function formatBytes(bytes: number, decimals?: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  let unitIndex = 0;
  let value = bytes;
  while (value >= DECIMAL_BASE && unitIndex < DECIMAL_UNITS.length - 1) {
    value /= DECIMAL_BASE;
    unitIndex += 1;
  }

  const unit = DECIMAL_UNITS[unitIndex] ?? "PB";

  if (unitIndex === 0) {
    return `${Math.round(value)} B`;
  }

  if (decimals !== undefined) {
    return `${value.toFixed(Math.max(0, decimals))} ${unit}`;
  }

  // Adaptive precision matching macOS Finder legibility
  let precision: number;
  if (unitIndex === 1) {
    // KB
    precision = value >= 10 ? 0 : 1;
  } else if (unitIndex === 2) {
    // MB
    precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  } else {
    // GB, TB, PB
    precision = value >= 100 ? 1 : 2;
  }

  return `${value.toFixed(precision)} ${unit}`;
}

/**
 * Compact decimal byte formatter for narrow badges, toolbar pills, and chart tooltips.
 */
export function formatBytesCompact(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  let unitIndex = 0;
  let value = bytes;
  while (value >= DECIMAL_BASE && unitIndex < DECIMAL_UNITS.length - 1) {
    value /= DECIMAL_BASE;
    unitIndex += 1;
  }

  const unit = DECIMAL_UNITS[unitIndex] ?? "PB";
  if (unitIndex === 0) {
    return `${Math.round(value)} B`;
  }

  const precision = value >= 100 ? 0 : 1;
  const formatted = value.toFixed(precision).replace(/\.0$/, "");
  return `${formatted} ${unit}`;
}

/**
 * Format an integer item/file/directory count with locale grouping separators.
 */
export function formatCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) {
    return "0";
  }
  return COUNT_FORMATTER.format(Math.round(count));
}

/**
 * Format a duration in milliseconds for scan throughput and completion telemetry.
 */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "0 ms";
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  if (seconds === 60) {
    return `${minutes + 1}m 0s`;
  }
  return `${minutes}m ${seconds}s`;
}

/**
 * Format a Unix epoch timestamp (in seconds) as a concise human-readable relative time.
 */
export function formatRelativeTime(
  secs: number | null | undefined,
  nowSecs: number = Math.floor(Date.now() / 1000),
): string {
  if (secs == null || !Number.isFinite(secs) || secs <= 0) {
    return "—";
  }

  const delta = nowSecs - secs;
  if (delta < 0) {
    return "Just now";
  }
  if (delta < 60) {
    return "Just now";
  }
  if (delta < 3600) {
    return `${Math.floor(delta / 60)}m ago`;
  }
  if (delta < 86_400) {
    return `${Math.floor(delta / 3600)}h ago`;
  }
  if (delta < 86_400 * 30) {
    return `${Math.floor(delta / 86_400)}d ago`;
  }
  if (delta < 86_400 * 365) {
    return `${Math.floor(delta / (86_400 * 30))}mo ago`;
  }
  return `${Math.floor(delta / (86_400 * 365))}y ago`;
}

/**
 * Format a percentage share cleanly for table and tooltip readouts.
 */
export function formatPercent(percent: number): string {
  if (!Number.isFinite(percent) || percent <= 0) {
    return "0%";
  }
  if (percent < 0.1) {
    return "<0.1%";
  }
  if (percent >= 99.95) {
    return "100%";
  }
  return `${percent.toFixed(1)}%`;
}

/**
 * Detect APFS sparse files (e.g., Docker `.raw`, VM images) where logical size
 * significantly exceeds physical allocated blocks.
 */
export function isSparseFile(
  physicalBytes: number,
  logicalBytes: number,
): boolean {
  return (
    logicalBytes > 0 &&
    logicalBytes > physicalBytes * 1.5 &&
    logicalBytes - physicalBytes >= 1_000_000
  );
}

const KNOWN_ARTIFACT_FILE_EXTENSION_RE =
  /\.(raw|dmg|img|iso|qcow2|vmdk|sparsebundle|sparseimage)$/i;

/**
 * Heuristic determining whether a matched developer artifact entry is a
 * directory (including hidden dot-directories like `.next`, `.nuxt`, `.turbo`,
 * `.venv`, `.pnpm-store`) rather than a disk image or regular file (`Docker.raw`).
 */
export function isArtifactDirectory(name: string): boolean {
  if (KNOWN_ARTIFACT_FILE_EXTENSION_RE.test(name)) {
    return false;
  }
  return !(name.includes(".") && !name.startsWith("."));
}
