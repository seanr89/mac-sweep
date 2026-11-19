import { AlertTriangle, Clock, Files, Folder, HardDrive } from "lucide-react";
import {
  formatBytes,
  formatCount,
  formatDurationMs,
} from "../../lib/format";
import { useSweepStore } from "../../store/useSweepStore";

export function ScanProgressBar() {
  const scanStatus = useSweepStore((s) => s.scanStatus);
  const scanProgress = useSweepStore((s) => s.scanProgress);

  if (scanStatus !== "scanning") {
    return null;
  }

  const filesScanned = scanProgress?.filesScanned ?? 0;
  const dirsScanned = scanProgress?.dirsScanned ?? 0;
  const physicalBytes = scanProgress?.physicalBytes ?? 0;
  const permissionErrors = scanProgress?.permissionErrors ?? 0;
  const elapsedMs = scanProgress?.elapsedMs ?? 0;
  const currentPath = scanProgress?.currentPath ?? "Starting parallel APFS scan…";

  const filesPerSec =
    elapsedMs > 50 ? Math.round((filesScanned / elapsedMs) * 1000) : 0;

  return (
    <div
      role="progressbar"
      aria-label="Scanning disk usage"
      aria-valuetext={`${formatCount(filesScanned)} files scanned, ${formatBytes(physicalBytes)}`}
      className="flex shrink-0 flex-col border-b border-blue-500/20 bg-blue-500/[0.06] dark:border-blue-400/20 dark:bg-blue-500/[0.08]"
    >
      {/* Indeterminate macOS activity hairline */}
      <div className="relative h-0.5 w-full overflow-hidden bg-blue-500/15">
        <div className="h-full w-1/3 animate-pulse rounded-r-full bg-blue-500 dark:bg-blue-400" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-1.5 text-[11.5px]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 tabular-nums text-neutral-700 dark:text-neutral-200">
          <span className="inline-flex items-center gap-1.5 font-medium text-blue-700 dark:text-blue-300">
            <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{formatBytes(physicalBytes)}</span>
            <span className="font-normal text-neutral-500 dark:text-neutral-400">
              physical
            </span>
          </span>

          <span className="inline-flex items-center gap-1">
            <Files
              className="h-3.5 w-3.5 text-neutral-400"
              aria-hidden="true"
            />
            <span>{formatCount(filesScanned)} files</span>
            {filesPerSec > 0 && (
              <span className="text-neutral-500 dark:text-neutral-400">
                ({formatCount(filesPerSec)}/s)
              </span>
            )}
          </span>

          <span className="inline-flex items-center gap-1">
            <Folder
              className="h-3.5 w-3.5 text-neutral-400"
              aria-hidden="true"
            />
            <span>{formatCount(dirsScanned)} dirs</span>
          </span>

          <span className="inline-flex items-center gap-1 text-neutral-500 dark:text-neutral-400">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{formatDurationMs(elapsedMs)}</span>
          </span>

          {permissionErrors > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              <span>{formatCount(permissionErrors)} skipped (TCC)</span>
            </span>
          )}
        </div>

        <div
          className="font-mac-mono max-w-[420px] truncate text-[11px] text-neutral-500 dark:text-neutral-400"
          title={currentPath}
        >
          {currentPath}
        </div>
      </div>
    </div>
  );
}
