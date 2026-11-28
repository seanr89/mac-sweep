import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowRight,
  Calendar,
  ExternalLink,
  FileText,
  Sparkles,
  Tag,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import appIconUrl from "../../../src-tauri/icons/128x128.png";
import {
  APP_FALLBACK_VERSION,
  BUNDLED_CHANGELOG_ENTRIES,
  type ChangelogEntry,
  getLatestChangelogEntry,
} from "../../lib/changelog";
import { isTauriRuntime } from "../../lib/ipc/client";

type AboutTab = "whats-new" | "changelog";

export interface AboutModalProps {
  open: boolean;
  onClose: () => void;
  version?: string;
  entries?: ChangelogEntry[];
}

function normalizeVersionTag(version: string): string {
  return version.trim().replace(/^v/i, "");
}

function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function openExternalUrl(url: string): void {
  if (!isSafeHttpUrl(url)) return;
  if (isTauriRuntime()) {
    void openUrl(url).catch(() => {});
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/**
 * Render simple inline markdown tokens (`**bold**`, `` `code` ``, and
 * `[label](https://...)` links) into React elements without
 * `dangerouslySetInnerHTML`.
 */
function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenRe = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(
        <strong
          key={`b-${keyIdx++}`}
          className="font-semibold text-neutral-900 dark:text-neutral-100"
        >
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={`c-${keyIdx++}`}
          className="font-mac-mono rounded bg-black/[0.06] px-1 py-0.5 text-[11px] text-neutral-800 dark:bg-white/[0.1] dark:text-neutral-200"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("[")) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        const label = linkMatch[1] ?? "";
        const url = (linkMatch[2] ?? "").trim();
        if (isSafeHttpUrl(url)) {
          nodes.push(
            <a
              key={`l-${keyIdx++}`}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                if (isTauriRuntime()) {
                  event.preventDefault();
                  openExternalUrl(url);
                }
              }}
              className="font-medium text-blue-600 underline decoration-blue-500/40 underline-offset-2 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              {label}
            </a>,
          );
        } else {
          nodes.push(label);
        }
      } else {
        nodes.push(token);
      }
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function ChangelogEntryCard({
  entry,
  isCurrent,
  showReleaseHeader = true,
}: {
  entry: ChangelogEntry;
  isCurrent: boolean;
  showReleaseHeader?: boolean;
}) {
  return (
    <section className="rounded-xl border border-black/[0.08] bg-black/[0.02] p-3.5 dark:border-white/[0.09] dark:bg-white/[0.03]">
      {showReleaseHeader && (
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-black/[0.06] pb-2 dark:border-white/[0.07]">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/12 px-2 py-0.5 text-[11.5px] font-semibold tabular-nums text-blue-700 dark:bg-blue-400/15 dark:text-blue-300">
              <Tag className="h-3 w-3" aria-hidden="true" />v
              {normalizeVersionTag(entry.version)}
            </span>
            {isCurrent && (
              <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300">
                Current
              </span>
            )}
          </div>
          {entry.date || (entry.url && isSafeHttpUrl(entry.url)) ? (
            <div className="flex items-center gap-2.5">
              {entry.date && (
                <span className="inline-flex items-center gap-1 text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
                  <Calendar className="h-3 w-3" aria-hidden="true" />
                  {entry.date}
                </span>
              )}
              {entry.url && isSafeHttpUrl(entry.url) && (
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`View v${normalizeVersionTag(entry.version)} release notes`}
                  onClick={(event) => {
                    if (isTauriRuntime()) {
                      event.preventDefault();
                      openExternalUrl(entry.url!);
                    }
                  }}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-neutral-500 transition-colors hover:bg-black/[0.06] hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/[0.08] dark:hover:text-neutral-100"
                >
                  <span>GitHub</span>
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
            </div>
          ) : null}
        </div>
      )}

      {entry.sections.length === 0 ? (
        <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
          No release notes recorded for this version.
        </p>
      ) : (
        <div className="space-y-3">
          {entry.sections.map((section) => (
            <div key={section.title}>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                {section.title}
              </h3>
              <ul className="space-y-1.5">
                {section.items.map((item, idx) => (
                  <li
                    key={`${section.title}-${idx}`}
                    className="flex items-start gap-2 text-[12px] leading-relaxed text-neutral-700 dark:text-neutral-300"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500/70 dark:bg-blue-400/70"
                    />
                    <span className="min-w-0 flex-1">
                      {renderInlineMarkdown(item)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function AboutModal({
  open,
  onClose,
  version,
  entries,
}: AboutModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const whatsNewTabRef = useRef<HTMLButtonElement>(null);
  const changelogTabRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const whatsNewTabId = useId();
  const changelogTabId = useId();
  const whatsNewPanelId = useId();
  const changelogPanelId = useId();

  const [activeTab, setActiveTab] = useState<AboutTab>("whats-new");
  const [runtimeVersion, setRuntimeVersion] = useState<string>(
    APP_FALLBACK_VERSION,
  );

  // Fetch live Tauri bundle version when running inside the desktop app
  useEffect(() => {
    if (version !== undefined) return;
    if (!isTauriRuntime()) return;

    let cancelled = false;
    void getVersion()
      .then((v) => {
        if (!cancelled && v.trim()) {
          setRuntimeVersion(v.trim());
        }
      })
      .catch(() => {
        // Fall back to bundled manifest version
      });

    return () => {
      cancelled = true;
    };
  }, [version]);

  // Reset to "What's New" whenever the modal opens
  useEffect(() => {
    if (open) {
      setActiveTab("whats-new");
    }
  }, [open]);

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

  const resolvedVersion = normalizeVersionTag(version ?? runtimeVersion);
  const resolvedEntries = entries ?? BUNDLED_CHANGELOG_ENTRIES;
  const latestEntry = getLatestChangelogEntry(resolvedEntries, resolvedVersion);

  const handleDialogCancel = (event: React.SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    onClose();
  };

  const handleDialogClose = () => {
    const dialog = dialogRef.current;
    if (dialog) {
      dialog.returnValue = "";
    }
    if (open) {
      onClose();
    }
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let nextTab: AboutTab | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      nextTab = activeTab === "whats-new" ? "changelog" : "whats-new";
    } else if (event.key === "Home") {
      nextTab = "whats-new";
    } else if (event.key === "End") {
      nextTab = "changelog";
    }

    if (!nextTab) return;

    event.preventDefault();
    setActiveTab(nextTab);
    if (nextTab === "whats-new") {
      whatsNewTabRef.current?.focus();
    } else {
      changelogTabRef.current?.focus();
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
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          onClose();
        }
      }}
      className="mac-dialog"
    >
      <div className="flex max-h-[calc(100vh-48px)] w-[520px] max-w-full flex-col overflow-hidden rounded-2xl border border-black/[0.12] bg-white/95 text-neutral-900 shadow-2xl backdrop-blur-2xl dark:border-white/[0.14] dark:bg-neutral-900/95 dark:text-neutral-100">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-black/[0.07] px-5 py-4 dark:border-white/[0.08]">
          <div className="flex items-center gap-3.5">
            <img
              src={appIconUrl}
              alt=""
              className="h-11 w-11 shrink-0 rounded-xl shadow-sm ring-1 ring-black/10 dark:ring-white/15"
            />
            <div>
              <div className="flex items-center gap-2">
                <h2
                  id={titleId}
                  className="text-[16px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100"
                >
                  Mac Sweep
                </h2>
                <span className="rounded-full border border-black/[0.08] bg-black/[0.04] px-2 py-0.5 text-[11px] font-medium tabular-nums text-neutral-700 dark:border-white/[0.12] dark:bg-white/[0.08] dark:text-neutral-200">
                  v{resolvedVersion}
                </span>
              </div>
              <p className="mt-0.5 text-[12px] text-neutral-600 dark:text-neutral-400">
                Native macOS disk space analyzer &amp; safe cleanup
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close About dialog"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-black/[0.06] hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/[0.08] dark:hover:text-neutral-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Segmented Tab Switcher */}
        <div className="shrink-0 border-b border-black/[0.07] px-5 py-2.5 dark:border-white/[0.08]">
          <div
            role="tablist"
            aria-label="About sections"
            onKeyDown={handleTabKeyDown}
            className="grid grid-cols-2 rounded-lg bg-black/[0.06] p-0.5 dark:bg-white/[0.08]"
          >
            <button
              ref={whatsNewTabRef}
              id={whatsNewTabId}
              type="button"
              role="tab"
              aria-selected={activeTab === "whats-new"}
              aria-controls={whatsNewPanelId}
              tabIndex={activeTab === "whats-new" ? 0 : -1}
              onClick={() => setActiveTab("whats-new")}
              className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-all ${
                activeTab === "whats-new"
                  ? "bg-white text-neutral-900 shadow-xs dark:bg-neutral-800 dark:text-neutral-100"
                  : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              <span>What&apos;s New</span>
            </button>

            <button
              ref={changelogTabRef}
              id={changelogTabId}
              type="button"
              role="tab"
              aria-selected={activeTab === "changelog"}
              aria-controls={changelogPanelId}
              tabIndex={activeTab === "changelog" ? 0 : -1}
              onClick={() => setActiveTab("changelog")}
              className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-all ${
                activeTab === "changelog"
                  ? "bg-white text-neutral-900 shadow-xs dark:bg-neutral-800 dark:text-neutral-100"
                  : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200"
              }`}
            >
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Full Changelog</span>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="mac-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div
            id={whatsNewPanelId}
            role="tabpanel"
            aria-labelledby={whatsNewTabId}
            hidden={activeTab !== "whats-new"}
          >
            {activeTab === "whats-new" && (
              <div className="space-y-3">
                {latestEntry ? (
                  <>
                    <div className="flex items-center justify-between text-[11.5px] text-neutral-500 dark:text-neutral-400">
                      <span className="font-medium text-neutral-700 dark:text-neutral-300">
                        Latest Versioned Changes
                      </span>
                      {latestEntry.date && (
                        <span className="tabular-nums">
                          Released {latestEntry.date}
                        </span>
                      )}
                    </div>
                    <ChangelogEntryCard
                      entry={latestEntry}
                      isCurrent={
                        normalizeVersionTag(latestEntry.version) ===
                        resolvedVersion
                      }
                    />
                  </>
                ) : (
                  <p className="rounded-xl border border-black/[0.08] bg-black/[0.02] p-4 text-center text-[12px] text-neutral-500 dark:border-white/[0.09] dark:bg-white/[0.03] dark:text-neutral-400">
                    No changelog entries available for this version.
                  </p>
                )}

                {resolvedEntries.length > 0 && (
                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={() => setActiveTab("changelog")}
                      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-blue-600 transition-colors hover:bg-blue-500/10 hover:text-blue-700 dark:text-blue-400 dark:hover:bg-blue-400/15 dark:hover:text-blue-300"
                    >
                      <span>View Full Changelog</span>
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div
            id={changelogPanelId}
            role="tabpanel"
            aria-labelledby={changelogTabId}
            hidden={activeTab !== "changelog"}
          >
            {activeTab === "changelog" && (
              <div className="space-y-3">
                {resolvedEntries.length > 0 ? (
                  resolvedEntries.map((entry) => (
                    <ChangelogEntryCard
                      key={`${entry.version}-${entry.date ?? "undated"}`}
                      entry={entry}
                      isCurrent={
                        normalizeVersionTag(entry.version) === resolvedVersion
                      }
                    />
                  ))
                ) : (
                  <p className="rounded-xl border border-black/[0.08] bg-black/[0.02] p-4 text-center text-[12px] text-neutral-500 dark:border-white/[0.09] dark:bg-white/[0.03] dark:text-neutral-400">
                    No changelog entries found in CHANGELOG.md.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-black/[0.07] bg-black/[0.02] px-5 py-3 dark:border-white/[0.08] dark:bg-white/[0.02]">
          <span className="text-[11.5px] tabular-nums text-neutral-500 dark:text-neutral-400">
            Mac Sweep · v{resolvedVersion}
          </span>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="inline-flex h-8 items-center justify-center rounded-lg bg-blue-600 px-4 text-[12.5px] font-medium text-white shadow-xs transition-colors hover:bg-blue-700 active:bg-blue-800 dark:bg-blue-500 dark:hover:bg-blue-400"
          >
            Done
          </button>
        </div>
      </div>
    </dialog>
  );
}
