import type {
  ArtifactGroupDto,
  ArtifactMatchDto,
  ArtifactRiskLevel,
  BreadcrumbDto,
  DeleteFailure,
  DeleteRequest,
  DeleteResult,
  DiskOverview,
  FdaStatus,
  FileCategory,
  NodeChildrenPage,
  NodeKey,
  NodeSummaryDto,
  SortDirection,
  SortField,
  SubtreeNodeDto,
} from "./types";

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

const NOW_SECS = 1_763_500_000;
const DAY = 86_400;

/**
 * Default mock Full Disk Access status (ungranted so UI banner can be exercised).
 */
export const MOCK_FDA_STATUS: FdaStatus = {
  granted: false,
  probedPath: "/Users/alex/Library/Safari",
  settingsUrl:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
};

/**
 * Default mock APFS Macintosh HD overview (500 GB SSD).
 */
export const MOCK_DISK_OVERVIEW: DiskOverview = {
  mountPoint: "/",
  volumeName: "Macintosh HD",
  totalBytes: 494_384_795_648,
  availableBytes: 142_610_423_808,
  usedBytes: 351_774_371_840,
  purgeableBytes: 18_420_000_000,
};

interface MockNodeInternal {
  id: NodeKey;
  parentId: NodeKey | null;
  name: string;
  isDir: boolean;
  isSymlink: boolean;
  isHardlinkDup: boolean;
  permissionDenied: boolean;
  physicalBytes: number;
  logicalBytes: number;
  fileCount: number;
  dirCount: number;
  modifiedSecs: number | null;
  category: FileCategory;
  children: NodeKey[];
  artifact?: {
    groupId: string;
    projectName: string | null;
    risk: ArtifactRiskLevel;
  };
}

interface ArtifactGroupMeta {
  id: string;
  label: string;
  description: string;
  risk: ArtifactRiskLevel;
}

const ARTIFACT_GROUP_META: Record<string, ArtifactGroupMeta> = {
  node_modules: {
    id: "node_modules",
    label: "Node.js Dependencies (node_modules)",
    description:
      "Reinstallable JavaScript/TypeScript package directories via pnpm, npm, or yarn.",
    risk: "safe",
  },
  rust_target: {
    id: "rust_target",
    label: "Rust Cargo Build Targets (target/)",
    description:
      "Compiled Rust artifacts regenerable via `cargo build` or `cargo check`.",
    risk: "safe",
  },
  xcode_derived_data: {
    id: "xcode_derived_data",
    label: "Xcode DerivedData",
    description:
      "Intermediate Xcode build products and indexes safe to rebuild automatically.",
    risk: "safe",
  },
  homebrew_cache: {
    id: "homebrew_cache",
    label: "Homebrew Download Cache",
    description:
      "Cached `.bottle.tar.gz` archives already installed by Homebrew.",
    risk: "safe",
  },
  python_venv: {
    id: "python_venv",
    label: "Python Virtual Environments (.venv)",
    description:
      "Local Python virtual environments recreatable from requirements or lockfiles.",
    risk: "safe",
  },
  ios_simulators: {
    id: "ios_simulators",
    label: "iOS Simulator Devices",
    description:
      "CoreSimulator device images. Review before deleting if simulators hold test data.",
    risk: "caution",
  },
  docker_vm: {
    id: "docker_vm",
    label: "Docker Desktop Disk Image (Docker.raw)",
    description:
      "Sparse APFS disk image containing Docker images, containers, and volumes.",
    risk: "caution",
  },
};

const PROTECTED_PATHS = new Set([
  "/",
  "/System",
  "/Applications",
  "/Users",
  "/Library",
  "/usr",
  "/bin",
  "/sbin",
  "/private",
  "/etc",
  "/var",
]);

interface NodeSpec {
  name: string;
  isDir?: boolean;
  isSymlink?: boolean;
  isHardlinkDup?: boolean;
  permissionDenied?: boolean;
  physicalBytes?: number;
  logicalBytes?: number;
  fileCount?: number;
  dirCount?: number;
  modifiedDaysAgo?: number;
  category: FileCategory;
  artifact?: {
    groupId: string;
    projectName: string | null;
    risk: ArtifactRiskLevel;
  };
  children?: NodeSpec[];
}

function buildMockTreeSpec(rootName: string): NodeSpec {
  return {
    name: rootName,
    isDir: true,
    category: "directory",
    modifiedDaysAgo: 0,
    children: [
      {
        name: "Library",
        isDir: true,
        category: "system",
        modifiedDaysAgo: 0,
        children: [
          {
            name: "Containers",
            isDir: true,
            category: "system",
            modifiedDaysAgo: 1,
            children: [
              {
                name: "com.docker.docker",
                isDir: true,
                category: "system",
                modifiedDaysAgo: 1,
                children: [
                  {
                    name: "Data",
                    isDir: true,
                    category: "system",
                    modifiedDaysAgo: 1,
                    children: [
                      {
                        name: "vms",
                        isDir: true,
                        category: "system",
                        modifiedDaysAgo: 1,
                        children: [
                          {
                            name: "Docker.raw",
                            isDir: false,
                            category: "diskImage",
                            // Sparse APFS file: 64 GiB logical size, 8.4 GiB allocated blocks
                            physicalBytes: Math.round(8.4 * GB),
                            logicalBytes: 64 * GB,
                            modifiedDaysAgo: 1,
                            artifact: {
                              groupId: "docker_vm",
                              projectName: "Docker Desktop",
                              risk: "caution",
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            name: "Developer",
            isDir: true,
            category: "code",
            modifiedDaysAgo: 2,
            children: [
              {
                name: "Xcode",
                isDir: true,
                category: "code",
                modifiedDaysAgo: 2,
                children: [
                  {
                    name: "DerivedData",
                    isDir: true,
                    category: "code",
                    modifiedDaysAgo: 2,
                    children: [
                      {
                        name: "MacSweep-g4k9x2",
                        isDir: true,
                        category: "code",
                        physicalBytes: Math.round(3.8 * GB),
                        logicalBytes: Math.round(3.9 * GB),
                        fileCount: 14_820,
                        dirCount: 610,
                        modifiedDaysAgo: 2,
                        artifact: {
                          groupId: "xcode_derived_data",
                          projectName: "MacSweep",
                          risk: "safe",
                        },
                      },
                      {
                        name: "CameraKit-p8m3q1",
                        isDir: true,
                        category: "code",
                        physicalBytes: Math.round(2.45 * GB),
                        logicalBytes: Math.round(2.5 * GB),
                        fileCount: 9_340,
                        dirCount: 412,
                        modifiedDaysAgo: 14,
                        artifact: {
                          groupId: "xcode_derived_data",
                          projectName: "CameraKit",
                          risk: "safe",
                        },
                      },
                    ],
                  },
                ],
              },
              {
                name: "CoreSimulator",
                isDir: true,
                category: "system",
                modifiedDaysAgo: 8,
                children: [
                  {
                    name: "Devices",
                    isDir: true,
                    category: "system",
                    physicalBytes: Math.round(6.15 * GB),
                    logicalBytes: Math.round(6.4 * GB),
                    fileCount: 31_400,
                    dirCount: 2_890,
                    modifiedDaysAgo: 8,
                    artifact: {
                      groupId: "ios_simulators",
                      projectName: "iOS 18.2 Simulators",
                      risk: "caution",
                    },
                  },
                ],
              },
            ],
          },
          {
            name: "Caches",
            isDir: true,
            category: "system",
            modifiedDaysAgo: 0,
            children: [
              {
                name: "Homebrew",
                isDir: true,
                category: "archive",
                physicalBytes: Math.round(1.92 * GB),
                logicalBytes: Math.round(1.92 * GB),
                fileCount: 486,
                dirCount: 18,
                modifiedDaysAgo: 5,
                artifact: {
                  groupId: "homebrew_cache",
                  projectName: "Homebrew",
                  risk: "safe",
                },
              },
              {
                name: "com.apple.Safari",
                isDir: true,
                category: "system",
                permissionDenied: true,
                physicalBytes: 0,
                logicalBytes: 0,
                fileCount: 0,
                dirCount: 0,
                modifiedDaysAgo: 0,
              },
            ],
          },
        ],
      },
      {
        name: "Projects",
        isDir: true,
        category: "code",
        modifiedDaysAgo: 0,
        children: [
          {
            name: "mac-sweep",
            isDir: true,
            category: "code",
            modifiedDaysAgo: 0,
            children: [
              {
                name: "target",
                isDir: true,
                category: "code",
                physicalBytes: Math.round(4.25 * GB),
                logicalBytes: Math.round(4.3 * GB),
                fileCount: 8_910,
                dirCount: 540,
                modifiedDaysAgo: 0,
                artifact: {
                  groupId: "rust_target",
                  projectName: "mac-sweep",
                  risk: "safe",
                },
              },
              {
                name: "node_modules",
                isDir: true,
                category: "code",
                physicalBytes: 620 * MB,
                logicalBytes: 645 * MB,
                fileCount: 24_120,
                dirCount: 3_180,
                modifiedDaysAgo: 1,
                artifact: {
                  groupId: "node_modules",
                  projectName: "mac-sweep",
                  risk: "safe",
                },
              },
              {
                name: "src",
                isDir: true,
                category: "code",
                modifiedDaysAgo: 0,
                children: [
                  {
                    name: "App.tsx",
                    category: "code",
                    physicalBytes: 24 * KB,
                    logicalBytes: 21 * KB,
                    modifiedDaysAgo: 0,
                  },
                  {
                    name: "TreemapCanvas.tsx",
                    category: "code",
                    physicalBytes: 40 * KB,
                    logicalBytes: 38 * KB,
                    modifiedDaysAgo: 0,
                  },
                ],
              },
            ],
          },
          {
            name: "dashboard-web",
            isDir: true,
            category: "code",
            modifiedDaysAgo: 4,
            children: [
              {
                name: "node_modules",
                isDir: true,
                category: "code",
                physicalBytes: Math.round(1.48 * GB),
                logicalBytes: Math.round(1.52 * GB),
                fileCount: 54_800,
                dirCount: 7_420,
                modifiedDaysAgo: 12,
                artifact: {
                  groupId: "node_modules",
                  projectName: "dashboard-web",
                  risk: "safe",
                },
              },
              {
                name: "dist",
                isDir: true,
                category: "code",
                physicalBytes: 185 * MB,
                logicalBytes: 185 * MB,
                fileCount: 142,
                dirCount: 14,
                modifiedDaysAgo: 4,
              },
            ],
          },
          {
            name: "ml-experiments",
            isDir: true,
            category: "code",
            modifiedDaysAgo: 6,
            children: [
              {
                name: ".venv",
                isDir: true,
                category: "code",
                physicalBytes: Math.round(2.15 * GB),
                logicalBytes: Math.round(2.2 * GB),
                fileCount: 41_200,
                dirCount: 3_910,
                modifiedDaysAgo: 9,
                artifact: {
                  groupId: "python_venv",
                  projectName: "ml-experiments",
                  risk: "safe",
                },
              },
              {
                name: "llama-3-8b-q4.gguf",
                category: "other",
                physicalBytes: Math.round(4.78 * GB),
                logicalBytes: Math.round(4.78 * GB),
                modifiedDaysAgo: 19,
              },
            ],
          },
        ],
      },
      {
        name: "Movies",
        isDir: true,
        category: "media",
        modifiedDaysAgo: 3,
        children: [
          {
            name: "4K-Drone-Coastline.mov",
            category: "media",
            physicalBytes: Math.round(11.6 * GB),
            logicalBytes: Math.round(11.6 * GB),
            modifiedDaysAgo: 11,
          },
          {
            name: "4K-Drone-Coastline-BackupLink.mov",
            category: "media",
            isHardlinkDup: true,
            // Hard-link duplicate: physicalBytes is 0 (deduplicated), logicalBytes preserves file size
            physicalBytes: 0,
            logicalBytes: Math.round(11.6 * GB),
            modifiedDaysAgo: 11,
          },
          {
            name: "MacSweep-Demo-Master.mp4",
            category: "media",
            physicalBytes: Math.round(3.25 * GB),
            logicalBytes: Math.round(3.25 * GB),
            modifiedDaysAgo: 3,
          },
          {
            name: "Podcast-Raw-Audio.wav",
            category: "media",
            physicalBytes: 840 * MB,
            logicalBytes: 840 * MB,
            modifiedDaysAgo: 21,
          },
        ],
      },
      {
        name: "Downloads",
        isDir: true,
        category: "archive",
        modifiedDaysAgo: 1,
        children: [
          {
            name: "Xcode_16.2.xip",
            category: "archive",
            physicalBytes: Math.round(7.85 * GB),
            logicalBytes: Math.round(7.85 * GB),
            modifiedDaysAgo: 28,
          },
          {
            name: "ubuntu-24.04-desktop-arm64.iso",
            category: "diskImage",
            physicalBytes: Math.round(2.62 * GB),
            logicalBytes: Math.round(2.62 * GB),
            modifiedDaysAgo: 16,
          },
          {
            name: "Design-Assets-2026.zip",
            category: "archive",
            physicalBytes: Math.round(1.34 * GB),
            logicalBytes: Math.round(1.34 * GB),
            modifiedDaysAgo: 7,
          },
          {
            name: "latest-build.dmg",
            isSymlink: true,
            category: "diskImage",
            physicalBytes: 4 * KB,
            logicalBytes: 36,
            modifiedDaysAgo: 1,
          },
        ],
      },
      {
        name: "Documents",
        isDir: true,
        category: "document",
        modifiedDaysAgo: 2,
        children: [
          {
            name: "Photos-2025-Archive.tar.gz",
            category: "archive",
            physicalBytes: Math.round(3.42 * GB),
            logicalBytes: Math.round(3.42 * GB),
            modifiedDaysAgo: 45,
          },
          {
            name: "Product-Keynote-2026.key",
            category: "document",
            physicalBytes: 248 * MB,
            logicalBytes: 248 * MB,
            modifiedDaysAgo: 5,
          },
          {
            name: "APFS-Architecture-Notes.pdf",
            category: "document",
            physicalBytes: 52 * MB,
            logicalBytes: 52 * MB,
            modifiedDaysAgo: 2,
          },
        ],
      },
    ],
  };
}

export interface MockScanTotals {
  totalFiles: number;
  totalDirs: number;
  totalPhysicalBytes: number;
  totalLogicalBytes: number;
  hardlinkDedupBytes: number;
  permissionErrors: number;
}

export interface MockScanStore {
  readonly rootId: NodeKey;
  readonly rootPath: string;
  getNode(nodeId: NodeKey): NodeSummaryDto | null;
  getNodeChildren(
    nodeId: NodeKey,
    offset: number,
    limit: number,
    sortBy: SortField,
    sortDir: SortDirection,
    filterQuery?: string | null,
  ): NodeChildrenPage;
  getTreemapSubtree(
    nodeId: NodeKey,
    maxDepth: number,
    maxChildren: number,
  ): SubtreeNodeDto;
  getNodeBreadcrumbs(nodeId: NodeKey): BreadcrumbDto[];
  getDevArtifacts(): ArtifactGroupDto[];
  deleteNodes(request: DeleteRequest): DeleteResult;
  getScanTotals(): MockScanTotals;
}

/**
 * Create an isolated, mutable mock arena tree mirroring Rust's `SlotMap` behavior:
 * - High-bit decimal `NodeKey` strings (> 2^53)
 * - Path reconstruction on demand via `parentId`
 * - Exact O(depth) ancestor roll-up upon deletion
 * - `ProtectedPathGuard` parity for protected macOS roots
 */
export function createMockScanStore(rootPath = "/Users/alex"): MockScanStore {
  const normalizedRoot =
    rootPath.length > 1 && rootPath.endsWith("/")
      ? rootPath.slice(0, -1)
      : rootPath;
  const rootName =
    normalizedRoot === "/"
      ? "/"
      : (normalizedRoot.split("/").filter(Boolean).pop() ?? "alex");

  const nodes = new Map<NodeKey, MockNodeInternal>();
  // Start above Number.MAX_SAFE_INTEGER (9007199254740991) to prove NodeKey string safety
  let nextKey = 9_007_199_254_741_001n;

  function allocKey(): NodeKey {
    const key = nextKey.toString(10);
    nextKey += 1n;
    return key;
  }

  function insertSpec(spec: NodeSpec, parentId: NodeKey | null): NodeKey {
    const id = allocKey();
    const isDir = spec.isDir ?? Boolean(spec.children && spec.children.length > 0);
    const modifiedSecs =
      spec.modifiedDaysAgo !== undefined
        ? NOW_SECS - spec.modifiedDaysAgo * DAY
        : NOW_SECS;

    const node: MockNodeInternal = {
      id,
      parentId,
      name: spec.name,
      isDir,
      isSymlink: spec.isSymlink ?? false,
      isHardlinkDup: spec.isHardlinkDup ?? false,
      permissionDenied: spec.permissionDenied ?? false,
      physicalBytes: spec.physicalBytes ?? 0,
      logicalBytes: spec.logicalBytes ?? spec.physicalBytes ?? 0,
      fileCount: isDir ? (spec.fileCount ?? 0) : 1,
      dirCount: isDir ? (spec.dirCount ?? 0) : 0,
      modifiedSecs,
      category: spec.category,
      children: [],
      artifact: spec.artifact,
    };

    nodes.set(id, node);

    if (spec.children && spec.children.length > 0) {
      let phys = 0;
      let log = 0;
      let files = 0;
      let dirs = 0;

      for (const childSpec of spec.children) {
        const childId = insertSpec(childSpec, id);
        node.children.push(childId);
        const child = nodes.get(childId);
        if (child) {
          phys += child.physicalBytes;
          log += child.logicalBytes;
          files += child.fileCount;
          dirs += child.dirCount + (child.isDir ? 1 : 0);
        }
      }

      node.physicalBytes = phys;
      node.logicalBytes = log;
      node.fileCount = files;
      node.dirCount = dirs;
    }

    return id;
  }

  const rootId = insertSpec(buildMockTreeSpec(rootName), null);

  function reconstructPath(nodeId: NodeKey): string {
    const segments: string[] = [];
    let current = nodes.get(nodeId);
    while (current && current.parentId !== null) {
      segments.push(current.name);
      current = nodes.get(current.parentId);
    }
    if (segments.length === 0) {
      return normalizedRoot;
    }
    segments.reverse();
    return normalizedRoot === "/"
      ? `/${segments.join("/")}`
      : `${normalizedRoot}/${segments.join("/")}`;
  }

  function toSummary(node: MockNodeInternal): NodeSummaryDto {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    const parentBytes = parent ? parent.physicalBytes : node.physicalBytes;
    const percentOfParent =
      parentBytes > 0 ? (node.physicalBytes / parentBytes) * 100 : 0;

    return {
      id: node.id,
      parentId: node.parentId,
      name: node.name,
      path: reconstructPath(node.id),
      isDir: node.isDir,
      isSymlink: node.isSymlink,
      isHardlinkDup: node.isHardlinkDup,
      permissionDenied: node.permissionDenied,
      physicalBytes: node.physicalBytes,
      logicalBytes: node.logicalBytes,
      fileCount: node.fileCount,
      dirCount: node.dirCount,
      modifiedSecs: node.modifiedSecs,
      category: node.category,
      percentOfParent: Math.round(percentOfParent * 100) / 100,
    };
  }

  function getNode(nodeId: NodeKey): NodeSummaryDto | null {
    const node = nodes.get(nodeId);
    return node ? toSummary(node) : null;
  }

  function getNodeChildren(
    nodeId: NodeKey,
    offset: number,
    limit: number,
    sortBy: SortField,
    sortDir: SortDirection,
    filterQuery?: string | null,
  ): NodeChildrenPage {
    const parent = nodes.get(nodeId);
    if (!parent) {
      throw { code: "NODE_NOT_FOUND", message: `Node not found: ${nodeId}` };
    }

    const normalizedFilter = filterQuery?.trim().toLowerCase() ?? "";
    const matching: MockNodeInternal[] = [];
    for (const childId of parent.children) {
      const child = nodes.get(childId);
      if (!child) continue;
      if (
        normalizedFilter.length > 0 &&
        !child.name.toLowerCase().includes(normalizedFilter)
      ) {
        continue;
      }
      matching.push(child);
    }

    const dirMultiplier = sortDir === "asc" ? 1 : -1;
    matching.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "physicalBytes":
          cmp = a.physicalBytes - b.physicalBytes;
          break;
        case "logicalBytes":
          cmp = a.logicalBytes - b.logicalBytes;
          break;
        case "name":
          cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
          break;
        case "fileCount":
          cmp = a.fileCount - b.fileCount;
          break;
        case "modifiedSecs":
          cmp = (a.modifiedSecs ?? 0) - (b.modifiedSecs ?? 0);
          break;
      }
      if (cmp === 0) {
        return a.name.localeCompare(b.name);
      }
      return cmp * dirMultiplier;
    });

    const safeOffset = Math.max(0, offset);
    const safeLimit = Math.max(1, limit);
    const sliced = matching.slice(safeOffset, safeOffset + safeLimit);

    return {
      parent: toSummary(parent),
      items: sliced.map(toSummary),
      totalCount: matching.length,
      offset: safeOffset,
      limit: safeLimit,
      hasMore: safeOffset + sliced.length < matching.length,
    };
  }

  function buildSubtree(
    node: MockNodeInternal,
    depthRemaining: number,
    maxChildren: number,
  ): SubtreeNodeDto {
    const childNodes: MockNodeInternal[] = [];
    for (const childId of node.children) {
      const child = nodes.get(childId);
      if (child) childNodes.push(child);
    }

    childNodes.sort((a, b) => b.physicalBytes - a.physicalBytes);

    if (depthRemaining === 0 || childNodes.length === 0) {
      return {
        id: node.id,
        name: node.name,
        path: reconstructPath(node.id),
        isDir: node.isDir,
        isHardlinkDup: node.isHardlinkDup,
        physicalBytes: node.physicalBytes,
        logicalBytes: node.logicalBytes,
        fileCount: node.fileCount,
        category: node.category,
        children: [],
        hasMoreChildren: childNodes.length > 0,
        aggregatedOtherBytes: 0,
      };
    }

    const cap = Math.max(1, maxChildren);
    const visible = childNodes.slice(0, cap);
    const overflow = childNodes.slice(cap);
    const aggregatedOtherBytes = overflow.reduce(
      (sum, item) => sum + item.physicalBytes,
      0,
    );

    return {
      id: node.id,
      name: node.name,
      path: reconstructPath(node.id),
      isDir: node.isDir,
      isHardlinkDup: node.isHardlinkDup,
      physicalBytes: node.physicalBytes,
      logicalBytes: node.logicalBytes,
      fileCount: node.fileCount,
      category: node.category,
      children: visible.map((child) =>
        buildSubtree(child, depthRemaining - 1, maxChildren),
      ),
      hasMoreChildren: overflow.length > 0,
      aggregatedOtherBytes,
    };
  }

  function getTreemapSubtree(
    nodeId: NodeKey,
    maxDepth: number,
    maxChildren: number,
  ): SubtreeNodeDto {
    const node = nodes.get(nodeId);
    if (!node) {
      throw { code: "NODE_NOT_FOUND", message: `Node not found: ${nodeId}` };
    }
    return buildSubtree(node, Math.max(0, maxDepth), Math.max(1, maxChildren));
  }

  function getNodeBreadcrumbs(nodeId: NodeKey): BreadcrumbDto[] {
    if (!nodes.has(nodeId)) {
      throw { code: "NODE_NOT_FOUND", message: `Node not found: ${nodeId}` };
    }
    const trail: BreadcrumbDto[] = [];
    let cursor: MockNodeInternal | undefined = nodes.get(nodeId);
    while (cursor) {
      trail.push({
        id: cursor.id,
        name: cursor.name,
        path: reconstructPath(cursor.id),
        physicalBytes: cursor.physicalBytes,
      });
      cursor = cursor.parentId ? nodes.get(cursor.parentId) : undefined;
    }
    trail.reverse();
    return trail;
  }

  function getDevArtifacts(): ArtifactGroupDto[] {
    const grouped = new Map<string, ArtifactMatchDto[]>();

    for (const node of nodes.values()) {
      if (!node.artifact) continue;
      const list = grouped.get(node.artifact.groupId) ?? [];
      list.push({
        nodeId: node.id,
        groupId: node.artifact.groupId,
        name: node.name,
        path: reconstructPath(node.id),
        projectName: node.artifact.projectName,
        physicalBytes: node.physicalBytes,
        logicalBytes: node.logicalBytes,
        fileCount: node.fileCount,
        modifiedSecs: node.modifiedSecs,
        risk: node.artifact.risk,
      });
      grouped.set(node.artifact.groupId, list);
    }

    const groups: ArtifactGroupDto[] = [];
    for (const [groupId, items] of grouped.entries()) {
      const meta = ARTIFACT_GROUP_META[groupId];
      if (!meta || items.length === 0) continue;
      items.sort((a, b) => b.physicalBytes - a.physicalBytes);
      groups.push({
        id: meta.id,
        label: meta.label,
        description: meta.description,
        risk: meta.risk,
        totalPhysicalBytes: items.reduce((sum, i) => sum + i.physicalBytes, 0),
        totalFileCount: items.reduce((sum, i) => sum + i.fileCount, 0),
        itemCount: items.length,
        items,
      });
    }

    groups.sort((a, b) => b.totalPhysicalBytes - a.totalPhysicalBytes);
    return groups;
  }

  function removeSubtreeRecursive(nodeId: NodeKey): void {
    const node = nodes.get(nodeId);
    if (!node) return;
    for (const childId of node.children) {
      removeSubtreeRecursive(childId);
    }
    nodes.delete(nodeId);
  }

  function deleteNodes(request: DeleteRequest): DeleteResult {
    const deletedNodeIds: NodeKey[] = [];
    const failures: DeleteFailure[] = [];
    let reclaimedPhysicalBytes = 0;
    let reclaimedLogicalBytes = 0;

    for (const nodeId of request.nodeIds) {
      const node = nodes.get(nodeId);
      if (!node) {
        failures.push({
          nodeId,
          path: "",
          code: "NODE_NOT_FOUND",
          reason: `Node not found: ${nodeId}`,
        });
        continue;
      }

      const path = reconstructPath(nodeId);
      if (nodeId === rootId || PROTECTED_PATHS.has(path)) {
        failures.push({
          nodeId,
          path,
          code: "PROTECTED_PATH",
          reason: `Refusing to modify protected path: ${path}`,
        });
        continue;
      }

      const physDelta = node.physicalBytes;
      const logDelta = node.logicalBytes;
      const fileDelta = node.fileCount;
      const dirDelta = node.dirCount + (node.isDir ? 1 : 0);

      // Unlink from parent
      if (node.parentId) {
        const parent = nodes.get(node.parentId);
        if (parent) {
          parent.children = parent.children.filter((cid) => cid !== nodeId);
        }
      }

      // Propagate decrements up the ancestor chain in O(depth)
      let ancestorId = node.parentId;
      while (ancestorId) {
        const ancestor = nodes.get(ancestorId);
        if (!ancestor) break;
        ancestor.physicalBytes = Math.max(0, ancestor.physicalBytes - physDelta);
        ancestor.logicalBytes = Math.max(0, ancestor.logicalBytes - logDelta);
        ancestor.fileCount = Math.max(0, ancestor.fileCount - fileDelta);
        ancestor.dirCount = Math.max(0, ancestor.dirCount - dirDelta);
        ancestorId = ancestor.parentId;
      }

      removeSubtreeRecursive(nodeId);
      deletedNodeIds.push(nodeId);
      reclaimedPhysicalBytes += physDelta;
      reclaimedLogicalBytes += logDelta;
    }

    const updatedRoot = getNode(rootId);
    return {
      deletedNodeIds,
      reclaimedPhysicalBytes,
      reclaimedLogicalBytes,
      failures,
      updatedRoot,
    };
  }

  function getScanTotals(): MockScanTotals {
    const root = nodes.get(rootId);
    let hardlinkDedupBytes = 0;
    let permissionErrors = 0;
    for (const node of nodes.values()) {
      if (node.isHardlinkDup) {
        hardlinkDedupBytes += node.logicalBytes;
      }
      if (node.permissionDenied) {
        permissionErrors += 1;
      }
    }
    return {
      totalFiles: root?.fileCount ?? 0,
      totalDirs: (root?.dirCount ?? 0) + 1,
      totalPhysicalBytes: root?.physicalBytes ?? 0,
      totalLogicalBytes: root?.logicalBytes ?? 0,
      hardlinkDedupBytes,
      permissionErrors,
    };
  }

  return {
    rootId,
    rootPath: normalizedRoot,
    getNode,
    getNodeChildren,
    getTreemapSubtree,
    getNodeBreadcrumbs,
    getDevArtifacts,
    deleteNodes,
    getScanTotals,
  };
}

const DEFAULT_READONLY_STORE = createMockScanStore("/Users/alex");

/** Root `NodeKey` of the default read-only mock fixture. */
export const MOCK_ROOT_ID: NodeKey = DEFAULT_READONLY_STORE.rootId;

/** Pre-built recursive subtree snapshot of the default mock fixture (depth 4). */
export const MOCK_SUBTREE: SubtreeNodeDto =
  DEFAULT_READONLY_STORE.getTreemapSubtree(MOCK_ROOT_ID, 4, 30);

/** Convenience read-only query helpers for visualization & component tests. */
export function getMockNodeChildren(
  nodeId: NodeKey,
  offset = 0,
  limit = 100,
  sortBy: SortField = "physicalBytes",
  sortDir: SortDirection = "desc",
  filterQuery?: string | null,
): NodeChildrenPage {
  return DEFAULT_READONLY_STORE.getNodeChildren(
    nodeId,
    offset,
    limit,
    sortBy,
    sortDir,
    filterQuery,
  );
}

export function getMockTreemapSubtree(
  nodeId: NodeKey = MOCK_ROOT_ID,
  maxDepth = 4,
  maxChildren = 40,
): SubtreeNodeDto {
  return DEFAULT_READONLY_STORE.getTreemapSubtree(nodeId, maxDepth, maxChildren);
}

export function getMockBreadcrumbs(nodeId: NodeKey): BreadcrumbDto[] {
  return DEFAULT_READONLY_STORE.getNodeBreadcrumbs(nodeId);
}

export function getMockDevArtifacts(): ArtifactGroupDto[] {
  return DEFAULT_READONLY_STORE.getDevArtifacts();
}
