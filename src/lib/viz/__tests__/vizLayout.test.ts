import { describe, expect, it, vi } from "vitest";
import { createMockScanStore } from "../../ipc/mockData";
import type { FileCategory, SubtreeNodeDto } from "../../ipc/types";
import {
  CATEGORY_PALETTE,
  formatVizBytes,
  formatVizPercent,
  getCategoryFill,
  getCategorySwatch,
} from "../palette";
import {
  computeSunburstLayout,
  hitTestSunburst,
  renderSunburstCanvas,
  TWO_PI,
} from "../sunburstLayout";
import {
  computeTreemapLayout,
  hitTestTreemap,
  renderTreemapCanvas,
} from "../treemapLayout";

const ALL_CATEGORIES: FileCategory[] = [
  "directory",
  "code",
  "media",
  "archive",
  "diskImage",
  "document",
  "system",
  "other",
];

/** Deterministic Mulberry32 PRNG for reproducible 50k-node benchmarks. */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a deterministic 50,000-node multi-depth `SubtreeNodeDto` hierarchy
 * with a realistic Zipf-like macOS file size distribution.
 */
function buildSyntheticTree(targetNodeCount: number): {
  root: SubtreeNodeDto;
  nodeCount: number;
} {
  const rng = createRng(20261118);
  let nextId = 1;
  let totalCreated = 0;

  const makeNode = (
    name: string,
    path: string,
    isDir: boolean,
    category: FileCategory,
    physicalBytes: number,
  ): SubtreeNodeDto => {
    totalCreated += 1;
    return {
      id: String(nextId++),
      name,
      path,
      isDir,
      isHardlinkDup: false,
      physicalBytes,
      logicalBytes: physicalBytes,
      fileCount: isDir ? 0 : 1,
      category,
      children: [],
      hasMoreChildren: false,
      aggregatedOtherBytes: 0,
    };
  };

  const root = makeNode("Macintosh HD", "/", true, "directory", 0);

  // Depth 1: 20 top-level directories
  const topDirCount = 20;
  const depth1Dirs: SubtreeNodeDto[] = [];
  for (let i = 0; i < topDirCount; i += 1) {
    const cat = ALL_CATEGORIES[i % ALL_CATEGORIES.length] ?? "other";
    const dir = makeNode(`dir_${i}`, `/dir_${i}`, true, cat, 0);
    root.children.push(dir);
    depth1Dirs.push(dir);
  }

  // Depth 2: 200 sub-directories (10 per depth-1 dir)
  const depth2Dirs: SubtreeNodeDto[] = [];
  for (let i = 0; i < depth1Dirs.length; i += 1) {
    const parent = depth1Dirs[i];
    if (!parent) continue;
    for (let j = 0; j < 10; j += 1) {
      const cat = ALL_CATEGORIES[(i + j) % ALL_CATEGORIES.length] ?? "other";
      const sub = makeNode(
        `sub_${i}_${j}`,
        `${parent.path}/sub_${j}`,
        true,
        cat,
        0,
      );
      parent.children.push(sub);
      depth2Dirs.push(sub);
    }
  }

  // Depth 3: 1,000 leaf-parent directories (5 per depth-2 dir)
  const depth3Dirs: SubtreeNodeDto[] = [];
  for (let i = 0; i < depth2Dirs.length; i += 1) {
    const parent = depth2Dirs[i];
    if (!parent) continue;
    for (let k = 0; k < 5; k += 1) {
      const cat = ALL_CATEGORIES[(i + k) % ALL_CATEGORIES.length] ?? "other";
      const leafDir = makeNode(
        `pkg_${i}_${k}`,
        `${parent.path}/pkg_${k}`,
        true,
        cat,
        0,
      );
      parent.children.push(leafDir);
      depth3Dirs.push(leafDir);
    }
  }

  // Fill remaining nodes up to exact `targetNodeCount` with files distributed
  // across depth 3 directories with heavy-tailed sizes.
  const remainingFiles = targetNodeCount - totalCreated;
  for (let f = 0; f < remainingFiles; f += 1) {
    const parent = depth3Dirs[f % depth3Dirs.length];
    if (!parent) continue;
    const r = rng();
    // Heavy-tailed distribution: a few large files + many small files
    const bytes = Math.max(
      4096,
      Math.round(Math.pow(1 / Math.max(0.0005, r), 1.45) * 4096),
    );
    const cat = ALL_CATEGORIES[(f + 2) % ALL_CATEGORIES.length] ?? "other";
    const file = makeNode(
      `file_${f}.dat`,
      `${parent.path}/file_${f}.dat`,
      false,
      cat,
      bytes,
    );
    parent.children.push(file);
  }

  // Bottom-up roll-up of physicalBytes, logicalBytes, and fileCount
  const rollUp = (node: SubtreeNodeDto): void => {
    if (node.children.length === 0) return;
    let phys = 0;
    let log = 0;
    let files = 0;
    for (const child of node.children) {
      rollUp(child);
      phys += child.physicalBytes;
      log += child.logicalBytes;
      files += child.fileCount;
    }
    node.physicalBytes = phys;
    node.logicalBytes = log;
    node.fileCount = files;
  };
  rollUp(root);

  return { root, nodeCount: totalCreated };
}

function createMockCanvasContext(): CanvasRenderingContext2D {
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textBaseline: "top",
    textAlign: "left",
    globalAlpha: 1,
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    setTransform: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

describe("palette & formatting", () => {
  it("formats macOS Finder decimal SI byte strings cleanly", () => {
    expect(formatVizBytes(0)).toBe("0 B");
    expect(formatVizBytes(-512)).toBe("0 B");
    expect(formatVizBytes(Number.NaN)).toBe("0 B");
    expect(formatVizBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
    expect(formatVizBytes(512)).toBe("512 B");
    expect(formatVizBytes(1_500)).toBe("1.5 KB");
    expect(formatVizBytes(24_000)).toBe("24 KB");
    expect(formatVizBytes(840_000_000)).toBe("840 MB");
    expect(formatVizBytes(8_400_000_000)).toBe("8.4 GB");
    expect(formatVizBytes(1_250_000_000_000)).toBe("1.25 TB");
  });

  it("formats percentages accurately including tiny and full shares", () => {
    expect(formatVizPercent(0, 100)).toBe("0%");
    expect(formatVizPercent(5, 0)).toBe("0%");
    expect(formatVizPercent(1, 50_000)).toBe("<0.1%");
    expect(formatVizPercent(25, 100)).toBe("25.0%");
    expect(formatVizPercent(100, 100)).toBe("100%");
  });

  it("provides distinct light/dark fills and depth shading for every FileCategory", () => {
    for (const cat of ALL_CATEGORIES) {
      expect(CATEGORY_PALETTE[cat]).toBeDefined();
      const lightD1 = getCategoryFill(cat, 1, "light");
      const lightD3 = getCategoryFill(cat, 3, "light");
      const darkD1 = getCategoryFill(cat, 1, "dark");
      const darkD3 = getCategoryFill(cat, 3, "dark");

      expect(lightD1).toMatch(/^hsl\(/);
      expect(darkD1).toMatch(/^hsl\(/);
      expect(lightD1).not.toBe(darkD1);
      expect(lightD1).not.toBe(lightD3);
      expect(darkD1).not.toBe(darkD3);

      expect(getCategorySwatch(cat, "light")).toMatch(/^hsl\(/);
      expect(getCategorySwatch(cat, "dark")).toMatch(/^hsl\(/);
    }

    expect(getCategoryFill("other", 1, "light", true)).toMatch(/^hsl\(/);
    expect(getCategoryFill("other", 1, "dark", true)).toMatch(/^hsl\(/);
  });
});

describe("treemapLayout", () => {
  it("computes valid finite bounds and accurate deepest-cell hit-testing on mock data", () => {
    const store = createMockScanStore("/Users/alex");
    const subtree = store.getTreemapSubtree(store.rootId, 6, 50);
    const width = 1000;
    const height = 700;

    const rects = computeTreemapLayout(subtree, width, height);
    expect(rects.length).toBeGreaterThan(5);

    for (const r of rects) {
      expect(Number.isFinite(r.x0)).toBe(true);
      expect(Number.isFinite(r.y0)).toBe(true);
      expect(Number.isFinite(r.x1)).toBe(true);
      expect(Number.isFinite(r.y1)).toBe(true);
      expect(r.width).toBeGreaterThanOrEqual(1.5);
      expect(r.height).toBeGreaterThanOrEqual(1.5);
      expect(r.x0).toBeGreaterThanOrEqual(0);
      expect(r.y0).toBeGreaterThanOrEqual(0);
      expect(r.x1).toBeLessThanOrEqual(width);
      expect(r.y1).toBeLessThanOrEqual(height);
    }

    // Verify sparse file metadata is preserved (Docker.raw: 8.4 GiB physical vs 64 GiB logical)
    const dockerRect = rects.find((r) => r.name === "Docker.raw");
    expect(dockerRect).toBeDefined();
    if (dockerRect) {
      expect(dockerRect.logicalBytes).toBeGreaterThan(
        dockerRect.physicalBytes * 5,
      );
    }

    // Verify hit-testing hits the deepest leaf at its midpoint
    const deepestLeaf = [...rects]
      .reverse()
      .find((r) => !r.hasVisibleChildren && r.width > 10 && r.height > 10);
    expect(deepestLeaf).toBeDefined();
    if (deepestLeaf) {
      const hit = hitTestTreemap(
        rects,
        deepestLeaf.x0 + deepestLeaf.width / 2,
        deepestLeaf.y0 + deepestLeaf.height / 2,
      );
      expect(hit?.id).toBe(deepestLeaf.id);
    }

    // Out-of-bounds and NaN misses
    expect(hitTestTreemap(rects, -10, -10)).toBeNull();
    expect(hitTestTreemap(rects, width + 50, height + 50)).toBeNull();
    expect(hitTestTreemap(rects, Number.NaN, 100)).toBeNull();

    // Render smoke test
    const ctx = createMockCanvasContext();
    renderTreemapCanvas(ctx, rects, width, height, {
      theme: "dark",
      hoveredId: deepestLeaf?.id ?? null,
      selectedId: rects[0]?.id ?? null,
    });
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it("emits a synthetic Other slice when aggregatedOtherBytes > 0 and culls sub-1.5px cells", () => {
    const subtree: SubtreeNodeDto = {
      id: "root",
      name: "Root",
      path: "/Root",
      isDir: true,
      isHardlinkDup: false,
      physicalBytes: 1_000_000,
      logicalBytes: 1_000_000,
      fileCount: 100,
      category: "directory",
      hasMoreChildren: true,
      aggregatedOtherBytes: 300_000,
      children: [
        {
          id: "big",
          name: "BigFile.bin",
          path: "/Root/BigFile.bin",
          isDir: false,
          isHardlinkDup: false,
          physicalBytes: 699_999,
          logicalBytes: 699_999,
          fileCount: 1,
          category: "other",
          children: [],
          hasMoreChildren: false,
          aggregatedOtherBytes: 0,
        },
        {
          id: "microscopic",
          name: "Tiny.txt",
          path: "/Root/Tiny.txt",
          isDir: false,
          isHardlinkDup: false,
          physicalBytes: 1,
          logicalBytes: 1,
          fileCount: 1,
          category: "document",
          children: [],
          hasMoreChildren: false,
          aggregatedOtherBytes: 0,
        },
      ],
    };

    const rects = computeTreemapLayout(subtree, 400, 300);
    const otherRect = rects.find((r) => r.isSyntheticOther);
    expect(otherRect).toBeDefined();
    expect(otherRect?.name).toBe("Other");
    expect(otherRect?.physicalBytes).toBe(300_000);

    // 1-byte file out of 1,000,000 bytes on a 400x300 canvas is far below 1.5px and must be culled
    expect(rects.find((r) => r.id === "microscopic")).toBeUndefined();
  });

  it("handles zero-byte trees, single leaf roots, and degenerate viewports safely", () => {
    const emptyTree: SubtreeNodeDto = {
      id: "empty",
      name: "Empty",
      path: "/Empty",
      isDir: true,
      isHardlinkDup: false,
      physicalBytes: 0,
      logicalBytes: 0,
      fileCount: 0,
      category: "directory",
      children: [],
      hasMoreChildren: false,
      aggregatedOtherBytes: 0,
    };

    expect(computeTreemapLayout(emptyTree, 800, 600)).toEqual([]);
    expect(computeTreemapLayout(emptyTree, 0, 600)).toEqual([]);
    expect(computeTreemapLayout(emptyTree, Number.NaN, 600)).toEqual([]);

    const singleLeaf: SubtreeNodeDto = {
      ...emptyTree,
      id: "leaf-dir",
      name: "ArchiveDir",
      physicalBytes: 5_000_000,
      logicalBytes: 5_000_000,
      fileCount: 42,
    };
    const rects = computeTreemapLayout(singleLeaf, 600, 400);
    expect(rects).toHaveLength(1);
    expect(rects[0]?.id).toBe("leaf-dir");
  });
});

describe("sunburstLayout", () => {
  it("computes valid polar arcs and exact center + sector hit-testing", () => {
    const store = createMockScanStore("/Users/alex");
    const subtree = store.getTreemapSubtree(store.rootId, 5, 40);
    const width = 800;
    const height = 600;

    const layout = computeSunburstLayout(subtree, width, height);
    expect(layout.arcs.length).toBeGreaterThan(5);
    expect(layout.cx).toBe(400);
    expect(layout.cy).toBe(300);
    expect(layout.innerHoleRadius).toBeCloseTo(layout.maxRadius * 0.24, 5);

    for (const arc of layout.arcs) {
      expect(arc.startAngle).toBeGreaterThanOrEqual(0);
      expect(arc.endAngle).toBeLessThanOrEqual(TWO_PI + 1e-9);
      expect(arc.endAngle - arc.startAngle).toBeGreaterThanOrEqual(0.004);
      expect(arc.innerRadius).toBeGreaterThanOrEqual(
        layout.innerHoleRadius - 1e-6,
      );
      expect(arc.outerRadius).toBeLessThanOrEqual(layout.maxRadius + 1e-6);
      expect(arc.outerRadius).toBeGreaterThan(arc.innerRadius);
    }

    // Center hub hit-test
    const centerHit = hitTestSunburst(
      layout.arcs,
      layout.cx,
      layout.cy,
      layout.cx,
      layout.cy,
      layout.innerHoleRadius,
    );
    expect(centerHit).toEqual({ kind: "center" });

    // Sector midpoint polar hit-test across all emitted arcs
    for (const arc of layout.arcs) {
      const midTheta = (arc.startAngle + arc.endAngle) / 2;
      const midR = (arc.innerRadius + arc.outerRadius) / 2;
      // Convert 12-o'clock clockwise angle back to Cartesian (x, y)
      const px = layout.cx + Math.cos(midTheta - Math.PI / 2) * midR;
      const py = layout.cy + Math.sin(midTheta - Math.PI / 2) * midR;
      const hit = hitTestSunburst(
        layout.arcs,
        px,
        py,
        layout.cx,
        layout.cy,
        layout.innerHoleRadius,
      );
      expect(hit?.kind).toBe("arc");
      if (hit?.kind === "arc") {
        expect(hit.arc.id).toBe(arc.id);
      }
    }

    // Outside outer radius returns null
    expect(
      hitTestSunburst(
        layout.arcs,
        layout.cx + layout.maxRadius + 25,
        layout.cy,
        layout.cx,
        layout.cy,
        layout.innerHoleRadius,
      ),
    ).toBeNull();

    // Render smoke test across animation progress
    const ctx = createMockCanvasContext();
    renderSunburstCanvas(
      ctx,
      layout.arcs,
      { ...layout.centerInfo, canNavigateUp: true },
      width,
      height,
      {
        theme: "light",
        hoveredId: layout.arcs[0]?.id ?? null,
        selectedId: layout.arcs[1]?.id ?? null,
        isCenterHovered: true,
      },
      0.5,
    );
    expect(ctx.arc).toHaveBeenCalled();
  });

  it("handles aggregatedOtherBytes and zero-byte trees safely in Sunburst", () => {
    const truncated: SubtreeNodeDto = {
      id: "root",
      name: "Root",
      path: "/Root",
      isDir: true,
      isHardlinkDup: false,
      physicalBytes: 1_000,
      logicalBytes: 1_000,
      fileCount: 10,
      category: "directory",
      hasMoreChildren: true,
      aggregatedOtherBytes: 400,
      children: [
        {
          id: "c1",
          name: "Large.mov",
          path: "/Root/Large.mov",
          isDir: false,
          isHardlinkDup: false,
          physicalBytes: 600,
          logicalBytes: 600,
          fileCount: 1,
          category: "media",
          children: [],
          hasMoreChildren: false,
          aggregatedOtherBytes: 0,
        },
      ],
    };

    const layout = computeSunburstLayout(truncated, 600, 600);
    const otherArc = layout.arcs.find((a) => a.isSyntheticOther);
    expect(otherArc).toBeDefined();
    expect(otherArc?.physicalBytes).toBe(400);

    const zeroLayout = computeSunburstLayout(
      { ...truncated, physicalBytes: 0, aggregatedOtherBytes: 0, children: [] },
      600,
      600,
    );
    expect(zeroLayout.arcs).toEqual([]);
  });
});

describe("50,000-node stress & hit-test latency benchmark", () => {
  it("lays out, culls, and hit-tests 50,000 nodes within interactive budgets", () => {
    const { root, nodeCount } = buildSyntheticTree(50_000);
    expect(nodeCount).toBe(50_000);

    const width = 1280;
    const height = 800;
    const rng = createRng(42);

    // 1. Treemap 50k layout + culling + 100 random hit-tests
    const t0 = performance.now();
    const rects = computeTreemapLayout(root, width, height);
    const treemapLayoutMs = performance.now() - t0;

    expect(rects.length).toBeGreaterThan(50);
    expect(rects.length).toBeLessThan(50_000);

    for (const r of rects) {
      expect(Number.isFinite(r.x0)).toBe(true);
      expect(Number.isFinite(r.y0)).toBe(true);
      expect(r.width).toBeGreaterThanOrEqual(1.5);
      expect(r.height).toBeGreaterThanOrEqual(1.5);
    }

    const th0 = performance.now();
    let treemapHits = 0;
    for (let i = 0; i < 100; i += 1) {
      const hit = hitTestTreemap(rects, rng() * width, rng() * height);
      if (hit) treemapHits += 1;
    }
    const treemapHitAvgMs = (performance.now() - th0) / 100;

    expect(treemapHits).toBeGreaterThan(0);
    expect(treemapHitAvgMs).toBeLessThan(2);
    expect(treemapLayoutMs).toBeLessThan(3000);

    // 2. Sunburst 50k layout + culling + 100 random hit-tests
    const s0 = performance.now();
    const sunburst = computeSunburstLayout(root, width, height);
    const sunburstLayoutMs = performance.now() - s0;

    expect(sunburst.arcs.length).toBeGreaterThan(20);
    expect(sunburst.arcs.length).toBeLessThan(50_000);

    for (const arc of sunburst.arcs) {
      expect(arc.startAngle).toBeGreaterThanOrEqual(0);
      expect(arc.endAngle).toBeLessThanOrEqual(TWO_PI + 1e-9);
      expect(arc.endAngle - arc.startAngle).toBeGreaterThanOrEqual(0.004);
    }

    const sh0 = performance.now();
    let sunburstHits = 0;
    for (let i = 0; i < 100; i += 1) {
      const hit = hitTestSunburst(
        sunburst.arcs,
        rng() * width,
        rng() * height,
        sunburst.cx,
        sunburst.cy,
        sunburst.innerHoleRadius,
      );
      if (hit) sunburstHits += 1;
    }
    const sunburstHitAvgMs = (performance.now() - sh0) / 100;

    expect(sunburstHits).toBeGreaterThan(0);
    expect(sunburstHitAvgMs).toBeLessThan(2);
    expect(sunburstLayoutMs).toBeLessThan(3000);

    console.info(
      `[50k Viz Benchmark] Treemap: ${treemapLayoutMs.toFixed(1)}ms layout (${rects.length} culled rects), ${treemapHitAvgMs.toFixed(4)}ms avg hit-test | Sunburst: ${sunburstLayoutMs.toFixed(1)}ms layout (${sunburst.arcs.length} culled arcs), ${sunburstHitAvgMs.toFixed(4)}ms avg hit-test`,
    );
  });
});
