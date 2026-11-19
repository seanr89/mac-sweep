import type { FileCategory } from "../ipc/types";

export type VizTheme = "light" | "dark";

export interface CategoryMeta {
  category: FileCategory;
  label: string;
  /** Base hue (0–360) for perceptual macOS palette. */
  hue: number;
  /** Saturation (%) in Light appearance. */
  lightSat: number;
  /** Base lightness (%) in Light appearance. */
  lightLit: number;
  /** Saturation (%) in Dark appearance. */
  darkSat: number;
  /** Base lightness (%) in Dark appearance. */
  darkLit: number;
}

/**
 * Perceptual macOS Sequoia-inspired color mapping for every `FileCategory`.
 * Tuned for legible contrast with white/dark labels and smooth depth shading.
 */
export const CATEGORY_PALETTE: Record<FileCategory, CategoryMeta> = {
  directory: {
    category: "directory",
    label: "Folders",
    hue: 211,
    lightSat: 78,
    lightLit: 56,
    darkSat: 74,
    darkLit: 46,
  },
  code: {
    category: "code",
    label: "Code",
    hue: 244,
    lightSat: 66,
    lightLit: 58,
    darkSat: 68,
    darkLit: 50,
  },
  media: {
    category: "media",
    label: "Media",
    hue: 342,
    lightSat: 76,
    lightLit: 57,
    darkSat: 72,
    darkLit: 48,
  },
  archive: {
    category: "archive",
    label: "Archives",
    hue: 31,
    lightSat: 86,
    lightLit: 53,
    darkSat: 82,
    darkLit: 47,
  },
  diskImage: {
    category: "diskImage",
    label: "Disk Images",
    hue: 280,
    lightSat: 62,
    lightLit: 56,
    darkSat: 62,
    darkLit: 48,
  },
  document: {
    category: "document",
    label: "Documents",
    hue: 156,
    lightSat: 58,
    lightLit: 44,
    darkSat: 56,
    darkLit: 40,
  },
  system: {
    category: "system",
    label: "System",
    hue: 204,
    lightSat: 24,
    lightLit: 52,
    darkSat: 26,
    darkLit: 41,
  },
  other: {
    category: "other",
    label: "Other",
    hue: 220,
    lightSat: 12,
    lightLit: 60,
    darkSat: 14,
    darkLit: 44,
  },
};

export const ORDERED_FILE_CATEGORIES: readonly CategoryMeta[] = [
  CATEGORY_PALETTE.media,
  CATEGORY_PALETTE.code,
  CATEGORY_PALETTE.archive,
  CATEGORY_PALETTE.diskImage,
  CATEGORY_PALETTE.document,
  CATEGORY_PALETTE.system,
  CATEGORY_PALETTE.directory,
  CATEGORY_PALETTE.other,
];

export interface VizSurfacePalette {
  canvasBg: string;
  cellBorder: string;
  containerHeaderBg: string;
  labelText: string;
  labelSubtext: string;
  hoverOverlay: string;
  hoverStroke: string;
  selectedStroke: string;
  selectedOuterRing: string;
  hubFill: string;
  hubHoverFill: string;
  hubStroke: string;
  hubTitle: string;
  hubSubtitle: string;
  hubHint: string;
  arcBorder: string;
}

const LIGHT_SURFACES: VizSurfacePalette = {
  canvasBg: "#f5f5f7",
  cellBorder: "rgba(255, 255, 255, 0.85)",
  containerHeaderBg: "rgba(15, 23, 42, 0.16)",
  labelText: "#ffffff",
  labelSubtext: "rgba(255, 255, 255, 0.84)",
  hoverOverlay: "rgba(255, 255, 255, 0.18)",
  hoverStroke: "rgba(15, 23, 42, 0.85)",
  selectedStroke: "#007aff",
  selectedOuterRing: "#ffffff",
  hubFill: "#ffffff",
  hubHoverFill: "#f0f5ff",
  hubStroke: "rgba(15, 23, 42, 0.12)",
  hubTitle: "#1d1d1f",
  hubSubtitle: "#6e6e73",
  hubHint: "#007aff",
  arcBorder: "rgba(255, 255, 255, 0.9)",
};

const DARK_SURFACES: VizSurfacePalette = {
  canvasBg: "#161618",
  cellBorder: "rgba(20, 20, 22, 0.82)",
  containerHeaderBg: "rgba(0, 0, 0, 0.28)",
  labelText: "#f5f5f7",
  labelSubtext: "rgba(245, 245, 247, 0.78)",
  hoverOverlay: "rgba(255, 255, 255, 0.14)",
  hoverStroke: "#ffffff",
  selectedStroke: "#0a84ff",
  selectedOuterRing: "#ffffff",
  hubFill: "#222225",
  hubHoverFill: "#2b2f3a",
  hubStroke: "rgba(255, 255, 255, 0.14)",
  hubTitle: "#f5f5f7",
  hubSubtitle: "#a1a1a6",
  hubHint: "#4da3ff",
  arcBorder: "rgba(22, 22, 24, 0.85)",
};

export function getVizSurfacePalette(theme: VizTheme): VizSurfacePalette {
  return theme === "dark" ? DARK_SURFACES : LIGHT_SURFACES;
}

/**
 * Compute a depth-shaded HSL fill string for a node cell or arc.
 * Deeper nesting subtly shifts luminance so parent/child hierarchy stays crisp.
 */
export function getCategoryFill(
  category: FileCategory,
  depth: number,
  theme: VizTheme,
  isSyntheticOther = false,
): string {
  const clampedDepth = Math.max(0, Math.min(depth, 8));

  if (isSyntheticOther) {
    if (theme === "dark") {
      const lit = Math.max(24, 35 - clampedDepth * 1.5);
      return `hsl(220 10% ${lit}%)`;
    }
    const lit = Math.min(78, 66 + clampedDepth * 1.8);
    return `hsl(220 10% ${lit}%)`;
  }

  const meta = CATEGORY_PALETTE[category] ?? CATEGORY_PALETTE.other;

  if (theme === "dark") {
    // Slightly brighten deeper cells in dark mode so nested leaves remain distinct
    const sat = Math.max(12, meta.darkSat - clampedDepth * 2);
    const lit = Math.min(64, Math.max(26, meta.darkLit + (clampedDepth - 1) * 3));
    return `hsl(${meta.hue} ${sat}% ${lit}%)`;
  }

  // Slightly darken/desaturate or lighten gracefully in light mode while preserving white label legibility
  const sat = Math.max(12, meta.lightSat - clampedDepth * 2.5);
  const lit = Math.max(36, Math.min(64, meta.lightLit - (clampedDepth - 1) * 2.5));
  return `hsl(${meta.hue} ${sat}% ${lit}%)`;
}

/** Solid swatch color for legend pills and tooltips. */
export function getCategorySwatch(
  category: FileCategory,
  theme: VizTheme,
): string {
  const meta = CATEGORY_PALETTE[category] ?? CATEGORY_PALETTE.other;
  return theme === "dark"
    ? `hsl(${meta.hue} ${meta.darkSat}% ${Math.min(62, meta.darkLit + 6)}%)`
    : `hsl(${meta.hue} ${meta.lightSat}% ${meta.lightLit}%)`;
}

/**
 * Format byte sizes using macOS Finder decimal (SI base-1000) units:
 * B, KB, MB, GB, TB, PB.
 */
const SI_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

export function formatVizBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  if (bytes < 1000) {
    return `${Math.round(bytes)} B`;
  }

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < SI_UNITS.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }

  const unit = SI_UNITS[unitIndex] ?? "PB";
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const formatted = value.toFixed(decimals).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
  return `${formatted} ${unit}`;
}

export function formatVizPercent(part: number, total: number): string {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0 || part <= 0) {
    return "0%";
  }
  const pct = (part / total) * 100;
  if (pct < 0.1) {
    return "<0.1%";
  }
  if (pct >= 99.95) {
    return "100%";
  }
  return `${pct >= 10 ? pct.toFixed(1) : pct.toFixed(2)}%`;
}

/** Read current macOS/browser color-scheme preference safely. */
export function getSystemTheme(): VizTheme {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Subscribe to runtime `prefers-color-scheme` changes so Canvas redraws
 * immediately when the user switches macOS Light/Dark appearance.
 */
export function subscribeSystemTheme(
  onChange: (theme: VizTheme) => void,
): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return () => {};
  }

  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = (event: MediaQueryListEvent) => {
    onChange(event.matches ? "dark" : "light");
  };

  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }
  return () => {};
}

/** Read `prefers-reduced-motion` preference safely. */
export function prefersReducedMotion(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
