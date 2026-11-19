import {
  AlertOctagon,
  AlertTriangle,
  Loader2,
  ShieldBan,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatBytes, formatCount } from "../../lib/format";
import type {
  DeleteMode,
  DeleteResult,
  NodeSummaryDto,
} from "../../lib/ipc/types";

export interface DeleteConfirmModalProps {
  open: boolean;
  targets: NodeSummaryDto[];
  isDeleting?: boolean;
  lastResult?: DeleteResult | null;
  onConfirm: (mode: DeleteMode) => void | Promise<unknown>;
  onClose: () => void;
}

export function DeleteConfirmModal({
  open,
  targets,
  isDeleting = false,
  lastResult = null,
  onConfirm,
  onClose,
}: DeleteConfirmModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const permanentToggleId = useId();
  const acknowledgeCheckboxId = useId();

  // Safety invariant: ALWAYS defaults to Finder Trash ("trash")
  const [mode, setMode] = useState<DeleteMode>("trash");
  const [permanentAcknowledged, setPermanentAcknowledged] = useState(false);

  // Reset to safe defaults every time the modal opens
  useEffect(() => {
    if (open) {
      setMode("trash");
      setPermanentAcknowledged(false);
    }
  }, [open, targets]);

  // Synchronize native <dialog> top-layer modal state
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        if (typeof dialog.showModal === "function") {
          dialog.showModal();
        } else {
          // jsdom fallback where HTMLDialogElement.prototype.showModal is unimplemented
          dialog.setAttribute("open", "");
        }
      }
    } else if (dialog.open || dialog.hasAttribute("open")) {
      if (typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
      dialog.returnValue = "";
    }
  }, [open]);

  const totalPhysicalBytes = useMemo(
    () => targets.reduce((sum, item) => sum + item.physicalBytes, 0),
    [targets],
  );

  const isPermanent = mode === "permanent";
  const hasFailures = Boolean(lastResult && lastResult.failures.length > 0);
  const confirmDisabled =
    isDeleting ||
    targets.length === 0 ||
    (isPermanent && !permanentAcknowledged);

  const handleDialogCancel = (event: React.SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    if (!isDeleting) {
      onClose();
    }
  };

  const handleDialogClose = () => {
    const dialog = dialogRef.current;
    if (dialog) {
      dialog.returnValue = "";
    }
    if (open && !isDeleting) {
      onClose();
    }
  };

  const handlePermanentToggle = (checked: boolean) => {
    setMode(checked ? "permanent" : "trash");
    if (!checked) {
      setPermanentAcknowledged(false);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={handleDialogCancel}
      onClose={handleDialogClose}
      className="mac-dialog"
    >
      <div className="flex max-h-[calc(100vh-48px)] w-full flex-col overflow-hidden rounded-2xl border border-black/[0.12] bg-white/95 text-neutral-900 shadow-2xl backdrop-blur-2xl dark:border-white/[0.14] dark:bg-neutral-900/95 dark:text-neutral-100">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-black/[0.07] px-5 py-4 dark:border-white/[0.08]">
          <div className="flex items-start gap-3">
            <div
              aria-hidden="true"
              className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                isPermanent
                  ? "bg-red-500/15 text-red-600 dark:bg-red-500/20 dark:text-red-400"
                  : "bg-blue-500/15 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400"
              }`}
            >
              {isPermanent ? (
                <AlertOctagon className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Trash2 className="h-5 w-5" aria-hidden="true" />
              )}
            </div>
            <div>
              <h2
                id={titleId}
                className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100"
              >
                {isPermanent
                  ? `Permanently delete ${formatCount(targets.length)} ${targets.length === 1 ? "item" : "items"}?`
                  : `Move ${formatCount(targets.length)} ${targets.length === 1 ? "item" : "items"} to Trash?`}
              </h2>
              <p className="mt-0.5 text-[12.5px] text-neutral-600 dark:text-neutral-400">
                Reclaims{" "}
                <strong className="tabular-nums font-semibold text-neutral-900 dark:text-neutral-100">
                  {formatBytes(totalPhysicalBytes)}
                </strong>{" "}
                of physical APFS storage.{" "}
                {isPermanent
                  ? "Bypassing Finder Trash is immediate and irreversible."
                  : "Items remain recoverable in Finder Trash until emptied."}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            aria-label="Close confirmation dialog"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-black/[0.06] hover:text-neutral-900 disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-white/[0.08] dark:hover:text-neutral-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="mac-scroll flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4">
          {/* Scrollable Path Preview */}
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              <span>Selected Items ({formatCount(targets.length)})</span>
              <span className="tabular-nums">
                {formatBytes(totalPhysicalBytes)} physical
              </span>
            </div>
            <ul className="mac-scroll max-h-44 divide-y divide-black/[0.06] overflow-y-auto rounded-lg border border-black/[0.08] bg-black/[0.02] dark:divide-white/[0.06] dark:border-white/[0.09] dark:bg-white/[0.03]">
              {targets.map((target) => (
                <li
                  key={target.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-[12px]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                      {target.name}
                    </div>
                    <div
                      title={target.path}
                      className="font-mac-mono truncate text-[10.5px] text-neutral-500 dark:text-neutral-400"
                    >
                      {target.path}
                    </div>
                  </div>
                  <span className="shrink-0 tabular-nums font-medium text-neutral-700 dark:text-neutral-300">
                    {formatBytes(target.physicalBytes)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* ProtectedPathGuard / Execution Failures */}
          {hasFailures && lastResult && (
            <div
              role="alert"
              className="rounded-lg border border-amber-500/35 bg-amber-500/[0.1] p-3 text-[12px] text-amber-950 dark:border-amber-400/30 dark:bg-amber-500/[0.12] dark:text-amber-100"
            >
              <div className="flex items-center gap-2 font-semibold">
                <ShieldBan
                  className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
                <span>
                  {lastResult.failures.length}{" "}
                  {lastResult.failures.length === 1 ? "item was" : "items were"}{" "}
                  blocked or could not be removed
                </span>
              </div>
              <ul className="mt-2 space-y-1.5">
                {lastResult.failures.map((failure) => (
                  <li
                    key={`${failure.nodeId}-${failure.code}`}
                    className="rounded bg-black/[0.05] px-2.5 py-1.5 text-[11.5px] dark:bg-black/25"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <code className="font-mac-mono truncate font-medium">
                        {failure.path || failure.nodeId}
                      </code>
                      <span className="shrink-0 rounded bg-amber-600/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-200">
                        {failure.code}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] opacity-90">
                      {failure.reason}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Explicit Permanent Deletion Opt-In */}
          <div className="rounded-lg border border-black/[0.08] bg-black/[0.02] p-3 dark:border-white/[0.09] dark:bg-white/[0.03]">
            <div className="flex items-center gap-2.5">
              <input
                id={permanentToggleId}
                type="checkbox"
                checked={isPermanent}
                disabled={isDeleting}
                onChange={(e) => handlePermanentToggle(e.target.checked)}
                className="h-4 w-4 rounded border-neutral-300 dark:border-neutral-600"
              />
              <label
                htmlFor={permanentToggleId}
                className="cursor-pointer select-none text-[12.5px] font-medium text-neutral-800 dark:text-neutral-200"
              >
                Delete permanently (bypass Finder Trash)
              </label>
            </div>

            {isPermanent && (
              <div className="mt-3 rounded-lg border border-red-500/35 bg-red-500/[0.1] p-3 text-[12px] text-red-950 dark:border-red-400/30 dark:bg-red-500/[0.14] dark:text-red-100">
                <div className="flex items-start gap-2">
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
                    aria-hidden="true"
                  />
                  <p className="leading-snug">
                    <strong className="font-semibold">
                      Permanent deletion cannot be undone.
                    </strong>{" "}
                    Files and directories will be unlinked immediately without
                    moving to macOS Finder Trash.
                  </p>
                </div>

                <div className="mt-2.5 flex items-start gap-2 border-t border-red-500/20 pt-2.5">
                  <input
                    id={acknowledgeCheckboxId}
                    type="checkbox"
                    checked={permanentAcknowledged}
                    disabled={isDeleting}
                    onChange={(e) => setPermanentAcknowledged(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-red-400"
                  />
                  <label
                    htmlFor={acknowledgeCheckboxId}
                    className="cursor-pointer select-none font-medium leading-snug"
                  >
                    I understand these items cannot be recovered from Trash
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-black/[0.07] bg-black/[0.02] px-5 py-3 dark:border-white/[0.08] dark:bg-white/[0.02]">
          <button
            type="button"
            autoFocus
            onClick={onClose}
            disabled={isDeleting}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-black/[0.1] bg-white px-3.5 text-[12.5px] font-medium text-neutral-800 shadow-2xs transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:border-white/[0.12] dark:bg-white/[0.07] dark:text-neutral-200 dark:hover:bg-white/[0.12]"
          >
            {hasFailures ? "Close" : "Cancel"}
          </button>

          <button
            type="button"
            disabled={confirmDisabled}
            onClick={() => void onConfirm(mode)}
            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-4 text-[12.5px] font-medium text-white shadow-xs transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
              isPermanent
                ? "bg-red-600 hover:bg-red-700 active:bg-red-800 dark:bg-red-600 dark:hover:bg-red-500"
                : "bg-blue-600 hover:bg-blue-700 active:bg-blue-800 dark:bg-blue-500 dark:hover:bg-blue-400"
            }`}
          >
            {isDeleting && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            )}
            <span>
              {isDeleting
                ? isPermanent
                  ? "Deleting…"
                  : "Moving to Trash…"
                : isPermanent
                  ? "Delete Permanently"
                  : "Move to Trash"}
            </span>
          </button>
        </div>
      </div>
    </dialog>
  );
}
