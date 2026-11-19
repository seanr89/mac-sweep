import { ExternalLink, RefreshCw, ShieldAlert, X } from "lucide-react";
import { useSweepStore } from "../../store/useSweepStore";

export function FdaBanner() {
  const fdaStatus = useSweepStore((s) => s.fdaStatus);
  const fdaBannerDismissed = useSweepStore((s) => s.fdaBannerDismissed);
  const openFdaSettings = useSweepStore((s) => s.openFdaSettings);
  const recheckFda = useSweepStore((s) => s.recheckFda);
  const dismissFdaBanner = useSweepStore((s) => s.dismissFdaBanner);

  if (!fdaStatus || fdaStatus.granted || fdaBannerDismissed) {
    return null;
  }

  return (
    <aside
      aria-label="Full Disk Access permission required"
      className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-amber-500/25 bg-amber-500/[0.1] px-4 py-2 text-[12px] text-amber-950 dark:border-amber-400/20 dark:bg-amber-500/[0.12] dark:text-amber-100"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <ShieldAlert
          className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
          aria-hidden="true"
        />
        <p className="min-w-0 leading-snug">
          <strong className="font-semibold">Full Disk Access is not enabled.</strong>{" "}
          macOS TCC blocked access to{" "}
          <code className="font-mac-mono rounded bg-amber-950/[0.08] px-1.5 py-0.5 text-[11px] dark:bg-amber-200/[0.12]">
            {fdaStatus.probedPath}
          </code>
          . Protected caches and Library folders will be skipped until granted.
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => void openFdaSettings()}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-amber-600 px-2.5 text-[11.5px] font-medium text-white shadow-xs transition-colors hover:bg-amber-700 active:bg-amber-800 dark:bg-amber-500 dark:text-neutral-950 dark:hover:bg-amber-400"
        >
          <span>Grant Full Disk Access</span>
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => void recheckFda()}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-amber-700/25 bg-white/70 px-2.5 text-[11.5px] font-medium text-amber-950 transition-colors hover:bg-white dark:border-amber-300/25 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/70"
        >
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
          <span>Re-check</span>
        </button>

        <button
          type="button"
          onClick={dismissFdaBanner}
          aria-label="Dismiss Full Disk Access banner"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-amber-800 transition-colors hover:bg-amber-900/10 dark:text-amber-200 dark:hover:bg-amber-100/10"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
