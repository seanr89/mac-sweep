import {
  FolderSearch,
  HardDrive,
  Home,
  Info,
  Loader2,
  XCircle,
} from "lucide-react";
import { formatBytesCompact } from "../../lib/format";
import { useSweepStore } from "../../store/useSweepStore";

function resolveHomePath(probedPath: string | undefined): string {
  if (probedPath) {
    const match = probedPath.match(/^(\/Users\/[^/]+)/);
    if (match?.[1]) {
      return match[1];
    }
  }
  return "~";
}

export function TitleBar() {
  const diskOverview = useSweepStore((s) => s.diskOverview);
  const fdaStatus = useSweepStore((s) => s.fdaStatus);
  const scanStatus = useSweepStore((s) => s.scanStatus);
  const scanSummary = useSweepStore((s) => s.scanSummary);
  const pickAndScan = useSweepStore((s) => s.pickAndScan);
  const scanDirectory = useSweepStore((s) => s.scanDirectory);
  const cancelScan = useSweepStore((s) => s.cancelScan);
  const openAboutModal = useSweepStore((s) => s.openAboutModal);

  const isScanning = scanStatus === "scanning";
  const homePath = resolveHomePath(fdaStatus?.probedPath);

  const usedPercent =
    diskOverview && diskOverview.totalBytes > 0
      ? Math.min(
          100,
          Math.max(0, (diskOverview.usedBytes / diskOverview.totalBytes) * 100),
        )
      : 0;

  const usageBarColor =
    usedPercent >= 90
      ? "bg-red-500"
      : usedPercent >= 78
        ? "bg-amber-500"
        : "bg-blue-500 dark:bg-blue-400";

  return (
    <header
      data-tauri-drag-region
      className="flex h-12 shrink-0 select-none items-center gap-3 border-b border-black/[0.08] bg-white/80 pl-[78px] pr-4 backdrop-blur-xl dark:border-white/[0.08] dark:bg-neutral-900/80"
    >
      {/* Brand Badge */}
      <div
        data-tauri-drag-region
        className="flex items-center gap-2 pr-1"
      >
        <div
          aria-hidden="true"
          className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-xs ring-1 ring-black/10 dark:ring-white/15"
        >
          <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />
        </div>
        <h1 className="text-[13px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          Mac Sweep
        </h1>
      </div>

      <div
        aria-hidden="true"
        className="h-4 w-px bg-black/[0.08] dark:bg-white/[0.1]"
      />

      {/* Quick Scan Controls */}
      <nav
        aria-label="Scan actions"
        className="flex items-center gap-1.5"
      >
        <button
          type="button"
          onClick={() => void pickAndScan()}
          disabled={isScanning}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-blue-600 px-2.5 text-[12px] font-medium text-white shadow-xs transition-colors hover:bg-blue-700 active:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-400"
        >
          <FolderSearch className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Scan Folder…</span>
          <kbd className="ml-0.5 hidden rounded bg-white/20 px-1 py-0.2 text-[10px] font-medium text-white/90 sm:inline">
            ⌘O
          </kbd>
        </button>

        <button
          type="button"
          onClick={() => void scanDirectory(homePath)}
          disabled={isScanning}
          className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            scanSummary?.rootPath === homePath
              ? "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:border-blue-400/40 dark:bg-blue-400/15 dark:text-blue-300"
              : "border-black/[0.09] bg-white/70 text-neutral-700 hover:bg-black/[0.04] dark:border-white/[0.1] dark:bg-white/[0.05] dark:text-neutral-200 dark:hover:bg-white/[0.1]"
          }`}
        >
          <Home className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Home</span>
        </button>

        <button
          type="button"
          onClick={() => void scanDirectory("/")}
          disabled={isScanning}
          className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            scanSummary?.rootPath === "/"
              ? "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:border-blue-400/40 dark:bg-blue-400/15 dark:text-blue-300"
              : "border-black/[0.09] bg-white/70 text-neutral-700 hover:bg-black/[0.04] dark:border-white/[0.1] dark:bg-white/[0.05] dark:text-neutral-200 dark:hover:bg-white/[0.1]"
          }`}
        >
          <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Macintosh HD</span>
        </button>

        {isScanning && (
          <button
            type="button"
            onClick={() => void cancelScan()}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-red-500/35 bg-red-500/10 px-2.5 text-[12px] font-medium text-red-700 transition-colors hover:bg-red-500/20 dark:border-red-400/35 dark:bg-red-500/15 dark:text-red-300 dark:hover:bg-red-500/25"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Cancel</span>
          </button>
        )}
      </nav>

      {/* Draggable Spacer */}
      <div data-tauri-drag-region className="flex-1" />

      {/* Disk Overview Capacity Pill */}
      {diskOverview && (
        <div
          className="flex items-center gap-2.5 rounded-full border border-black/[0.08] bg-black/[0.03] px-3 py-1 text-[11px] dark:border-white/[0.09] dark:bg-white/[0.05]"
          title={
            diskOverview.purgeableBytes != null
              ? `${diskOverview.volumeName} (${diskOverview.mountPoint}) — ${formatBytesCompact(diskOverview.purgeableBytes)} APFS purgeable`
              : `${diskOverview.volumeName} (${diskOverview.mountPoint})`
          }
        >
          <span className="font-medium text-neutral-700 dark:text-neutral-200">
            {diskOverview.volumeName}
          </span>
          <div
            className="h-1.5 w-16 overflow-hidden rounded-full bg-black/[0.1] dark:bg-white/[0.12]"
            aria-hidden="true"
          >
            <div
              className={`h-full rounded-full ${usageBarColor}`}
              style={{ width: `${usedPercent}%` }}
            />
          </div>
          <span className="tabular-nums text-neutral-600 dark:text-neutral-300">
            <strong className="font-semibold text-neutral-900 dark:text-neutral-100">
              {formatBytesCompact(diskOverview.availableBytes)}
            </strong>{" "}
            free of {formatBytesCompact(diskOverview.totalBytes)}
          </span>
        </div>
      )}

      {/* About & Changelog Button */}
      <button
        type="button"
        onClick={openAboutModal}
        aria-label="About Mac Sweep"
        title="About Mac Sweep"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-black/[0.09] bg-white/70 text-neutral-600 transition-colors hover:bg-black/[0.04] hover:text-neutral-900 dark:border-white/[0.1] dark:bg-white/[0.05] dark:text-neutral-300 dark:hover:bg-white/[0.1] dark:hover:text-neutral-100"
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </header>
  );
}
