import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatBytes,
  formatBytesCompact,
  formatCount,
  formatDurationMs,
  formatRelativeTime,
  isArtifactDirectory,
  isSparseFile,
} from "../../lib/format";
import { MockIpcClient, setIpcClient } from "../../lib/ipc/client";
import { useSweepStore } from "../useSweepStore";

async function waitForStore(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for store predicate");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("format utilities", () => {
  it("formats macOS Finder decimal bytes and detects APFS sparse files", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1_500_000_000)).toBe("1.50 GB");
    expect(formatBytes(494_384_795_648)).toBe("494.4 GB");
    expect(formatBytesCompact(8_400_000_000)).toBe("8.4 GB");
    expect(formatCount(12_345)).toBe("12,345");
    expect(formatDurationMs(450)).toBe("450 ms");
    expect(formatDurationMs(2350)).toBe("2.4s");
    expect(formatDurationMs(125_000)).toBe("2m 5s");
    expect(formatRelativeTime(1_000_000, 1_000_030)).toBe("Just now");
    expect(formatRelativeTime(1_000_000, 1_000_000 + 3 * 86_400)).toBe("3d ago");

    // Sparse Docker.raw: 8.4 GB physical, 64 GB logical
    expect(isSparseFile(8_400_000_000, 64_000_000_000)).toBe(true);
    // Normal file: equal physical and logical
    expect(isSparseFile(50_000_000, 50_000_000)).toBe(false);
    // Tiny file under 1 MB delta threshold
    expect(isSparseFile(4_096, 20_000)).toBe(false);

    // Artifact directory heuristic: hidden dot-dirs are directories, disk images are files
    expect(isArtifactDirectory(".next")).toBe(true);
    expect(isArtifactDirectory(".nuxt")).toBe(true);
    expect(isArtifactDirectory(".turbo")).toBe(true);
    expect(isArtifactDirectory(".venv")).toBe(true);
    expect(isArtifactDirectory(".pnpm-store")).toBe(true);
    expect(isArtifactDirectory("node_modules")).toBe(true);
    expect(isArtifactDirectory("Docker.raw")).toBe(false);
    expect(isArtifactDirectory("installer.dmg")).toBe(false);
    expect(isArtifactDirectory("vm.qcow2")).toBe(false);
    expect(isArtifactDirectory("disk.vmdk")).toBe(false);
    expect(isArtifactDirectory("backup.sparsebundle")).toBe(false);
  });
});

describe("useSweepStore", () => {
  let mockClient: MockIpcClient;

  beforeEach(() => {
    mockClient = new MockIpcClient({
      stepDelayMs: 5,
      initialFdaGranted: false,
    });
    setIpcClient(mockClient);
    useSweepStore.getState().resetStore();
  });

  afterEach(() => {
    setIpcClient(null);
    vi.restoreAllMocks();
  });

  it("probes Full Disk Access and disk overview on bootstrap()", async () => {
    await useSweepStore.getState().bootstrap();

    const state = useSweepStore.getState();
    expect(state.fdaStatus).not.toBeNull();
    expect(state.fdaStatus?.granted).toBe(false);
    expect(state.fdaStatus?.probedPath).toBe("/Users/alex/Library/Safari");
    expect(state.diskOverview?.volumeName).toBe("Macintosh HD");
    expect(state.diskOverview?.totalBytes).toBeGreaterThan(0);

    // Clicking "Grant Full Disk Access" and then "Re-check" updates status
    await useSweepStore.getState().openFdaSettings();
    await useSweepStore.getState().recheckFda();
    expect(useSweepStore.getState().fdaStatus?.granted).toBe(true);
  });

  it("runs a mock scan lifecycle and loads breadcrumbs, subtree, children, and dev presets", async () => {
    await useSweepStore.getState().scanDirectory("/Users/alex");
    expect(useSweepStore.getState().scanStatus).toBe("scanning");

    await waitForStore(
      () =>
        useSweepStore.getState().scanStatus === "completed" &&
        useSweepStore.getState().childrenPage !== null &&
        useSweepStore.getState().vizSubtree !== null,
    );

    const state = useSweepStore.getState();
    expect(state.rootNodeId).toBeTruthy();
    expect(state.currentNodeId).toBe(state.rootNodeId);
    expect(state.breadcrumbs).toHaveLength(1);
    expect(state.breadcrumbs[0]?.path).toBe("/Users/alex");
    expect(state.childrenPage?.items.length).toBeGreaterThan(0);
    expect(state.artifactGroups.length).toBeGreaterThan(0);
    expect(state.scanSummary?.totalPhysicalBytes).toBeGreaterThan(0);
  });

  it("supports drill-down, breadcrumb navigation, sorting, and filtering", async () => {
    await useSweepStore.getState().scanDirectory("/Users/alex");
    await waitForStore(
      () =>
        useSweepStore.getState().scanStatus === "completed" &&
        useSweepStore.getState().childrenPage !== null,
    );

    const rootId = useSweepStore.getState().rootNodeId!;
    const projectsDir = useSweepStore
      .getState()
      .childrenPage!.items.find((item) => item.name === "Projects");
    expect(projectsDir).toBeDefined();

    // Drill down into Projects
    await useSweepStore.getState().drillDown(projectsDir!.id);
    expect(useSweepStore.getState().currentNodeId).toBe(projectsDir!.id);
    expect(useSweepStore.getState().breadcrumbs.map((b) => b.name)).toEqual([
      "alex",
      "Projects",
    ]);

    // Sort by name ascending, then toggle to descending
    await useSweepStore.getState().setSort("name");
    expect(useSweepStore.getState().sortBy).toBe("name");
    expect(useSweepStore.getState().sortDir).toBe("asc");
    const ascNames = useSweepStore
      .getState()
      .childrenPage!.items.map((i) => i.name);
    expect(ascNames).toEqual([...ascNames].sort((a, b) => a.localeCompare(b)));

    await useSweepStore.getState().setSort("name");
    expect(useSweepStore.getState().sortDir).toBe("desc");

    // Filter inside Projects
    await useSweepStore.getState().setFilterQuery("sweep");
    expect(useSweepStore.getState().childrenPage?.items).toHaveLength(1);
    expect(useSweepStore.getState().childrenPage?.items[0]?.name).toBe(
      "mac-sweep",
    );

    // Navigate back to root via breadcrumb (clears filter)
    await useSweepStore.getState().navigateBreadcrumb(rootId);
    expect(useSweepStore.getState().currentNodeId).toBe(rootId);
    expect(useSweepStore.getState().filterQuery).toBe("");
    expect(useSweepStore.getState().breadcrumbs).toHaveLength(1);
  });

  it("refreshes arena state instantaneously after delete without triggering a rescan", async () => {
    await useSweepStore.getState().scanDirectory("/Users/alex");
    await waitForStore(
      () =>
        useSweepStore.getState().scanStatus === "completed" &&
        useSweepStore.getState().childrenPage !== null,
    );

    const startScanSpy = vi.spyOn(mockClient, "startScan");
    const initialTotalPhysical =
      useSweepStore.getState().scanSummary!.totalPhysicalBytes;

    // Drill into Downloads and delete the largest file (Xcode_16.2.xip)
    const downloadsDir = useSweepStore
      .getState()
      .childrenPage!.items.find((item) => item.name === "Downloads");
    expect(downloadsDir).toBeDefined();

    await useSweepStore.getState().drillDown(downloadsDir!.id);
    const xcodeArchive = useSweepStore
      .getState()
      .childrenPage!.items.find((item) => item.name === "Xcode_16.2.xip");
    expect(xcodeArchive).toBeDefined();

    useSweepStore.getState().selectNodes([xcodeArchive!.id]);
    useSweepStore.getState().openDeleteModal([xcodeArchive!]);

    const result = await useSweepStore.getState().confirmDelete("trash");
    expect(result).not.toBeNull();
    expect(result?.deletedNodeIds).toEqual([xcodeArchive!.id]);
    expect(result?.reclaimedPhysicalBytes).toBe(xcodeArchive!.physicalBytes);
    expect(result?.failures).toHaveLength(0);

    // MUST NOT rescan
    expect(startScanSpy).not.toHaveBeenCalled();

    // Arena totals, children list, selection, and modal state updated instantaneously
    const after = useSweepStore.getState();
    expect(after.deleteModalOpen).toBe(false);
    expect(after.selectedNodeIds.size).toBe(0);
    expect(
      after.childrenPage?.items.some((i) => i.id === xcodeArchive!.id),
    ).toBe(false);
    expect(after.scanSummary?.totalPhysicalBytes).toBe(
      initialTotalPhysical - xcodeArchive!.physicalBytes,
    );
    expect(after.toast?.tone).toBe("success");
  });

  it("prunes succeeded targets from pendingDeleteTargets when a partial delete has failures", async () => {
    await useSweepStore.getState().scanDirectory("/Users/alex");
    await waitForStore(
      () =>
        useSweepStore.getState().scanStatus === "completed" &&
        useSweepStore.getState().childrenPage !== null,
    );

    const rootNode = useSweepStore.getState().childrenPage!.parent;
    const downloadsDir = useSweepStore
      .getState()
      .childrenPage!.items.find((item) => item.name === "Downloads");
    expect(downloadsDir).toBeDefined();

    await useSweepStore.getState().drillDown(downloadsDir!.id);
    const zipFile = useSweepStore
      .getState()
      .childrenPage!.items.find((item) => item.name === "Design-Assets-2026.zip");
    expect(zipFile).toBeDefined();

    // Queue one deletable file and the protected scan root node
    useSweepStore.getState().openDeleteModal([zipFile!, rootNode]);
    const result = await useSweepStore.getState().confirmDelete("trash");

    expect(result).not.toBeNull();
    expect(result?.deletedNodeIds).toEqual([zipFile!.id]);
    expect(result?.failures).toHaveLength(1);
    expect(result?.failures[0]?.code).toBe("PROTECTED_PATH");

    // Modal stays open to show the failure, and already-deleted item is pruned from pendingDeleteTargets
    const after = useSweepStore.getState();
    expect(after.deleteModalOpen).toBe(true);
    expect(after.pendingDeleteTargets.map((t) => t.id)).toEqual([rootNode.id]);
    expect(after.toast?.tone).toBe("warning");
  });
});
