import { FolderOpen, Search, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { NodeKey } from "../../lib/ipc/types";
import { formatVizBytes } from "../../lib/viz/palette";

export type VizContextAction = "zoom" | "reveal" | "trash";

export interface VizContextMenuTarget {
  id: NodeKey;
  name: string;
  isDir: boolean;
  physicalBytes: number;
  x: number;
  y: number;
}

export interface VizContextMenuProps {
  target: VizContextMenuTarget;
  containerWidth: number;
  containerHeight: number;
  onAction: (action: VizContextAction, nodeId: NodeKey) => void;
  onClose: () => void;
}

const MENU_EST_WIDTH = 216;
const MENU_EST_HEIGHT = 156;
const EDGE_MARGIN = 8;

export function VizContextMenu({
  target,
  containerWidth,
  containerHeight,
  onAction,
  onClose,
}: VizContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const menuEl = menuRef.current;
    if (!menuEl) return;

    const hasNativeFocusGroup =
      typeof HTMLElement !== "undefined" &&
      "focusGroup" in HTMLElement.prototype;

    if (!hasNativeFocusGroup) {
      menuEl.setAttribute("role", "menu");
      menuEl.querySelectorAll("button").forEach((btn) => {
        btn.setAttribute("role", "menuitem");
      });
    }

    // Focus first enabled item for immediate keyboard accessibility
    const firstEnabled = menuEl.querySelector<HTMLButtonElement>(
      "button:not(:disabled)",
    );
    firstEnabled?.focus({ preventScroll: true });

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuEl.contains(event.target)) {
        onClose();
      }
    };

    const handleWindowBlur = () => {
      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        previousFocusRef.current?.focus({ preventScroll: true });
        return;
      }

      if (event.key === "Tab") {
        onClose();
        return;
      }

      if (
        !hasNativeFocusGroup &&
        (event.key === "ArrowDown" ||
          event.key === "ArrowUp" ||
          event.key === "Home" ||
          event.key === "End")
      ) {
        const items = Array.from(
          menuEl.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
        );
        if (items.length === 0) return;

        const currentIndex = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        let nextIndex = 0;
        if (event.key === "Home") {
          nextIndex = 0;
        } else if (event.key === "End") {
          nextIndex = items.length - 1;
        } else if (event.key === "ArrowDown") {
          nextIndex =
            currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
        } else {
          nextIndex =
            currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
        }

        event.preventDefault();
        items[nextIndex]?.focus({ preventScroll: true });
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("blur", handleWindowBlur);
    menuEl.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("blur", handleWindowBlur);
      menuEl.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const left = Math.max(
    EDGE_MARGIN,
    Math.min(target.x, containerWidth - MENU_EST_WIDTH - EDGE_MARGIN),
  );
  const top = Math.max(
    EDGE_MARGIN,
    Math.min(target.y, containerHeight - MENU_EST_HEIGHT - EDGE_MARGIN),
  );

  const handleSelect = (action: VizContextAction) => {
    onAction(action, target.id);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      {...({ focusgroup: "menu nomemory" } as Record<string, string>)}
      aria-label={`Actions for ${target.name}`}
      style={{
        left: `${Math.round(left)}px`,
        top: `${Math.round(top)}px`,
      }}
      className="absolute z-40 w-54 rounded-xl border border-neutral-200/90 bg-white/95 p-1.5 text-xs text-neutral-900 shadow-xl ring-1 ring-black/8 backdrop-blur-xl dark:border-neutral-700/80 dark:bg-neutral-900/95 dark:text-neutral-100 dark:ring-white/10"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-2 py-1 text-[11px] text-neutral-500 dark:text-neutral-400">
        <div className="truncate font-medium text-neutral-800 dark:text-neutral-200">
          {target.name}
        </div>
        <div className="tabular-nums">{formatVizBytes(target.physicalBytes)}</div>
      </div>

      <hr className="my-1 border-neutral-200/80 dark:border-neutral-800" />

      <button
        type="button"
        disabled={!target.isDir}
        onClick={() => handleSelect("zoom")}
        className="flex min-h-7 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left font-medium transition-colors hover:bg-blue-500 hover:text-white focus-visible:bg-blue-500 focus-visible:text-white focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-inherit"
      >
        <Search aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span>Zoom In</span>
      </button>

      <button
        type="button"
        onClick={() => handleSelect("reveal")}
        className="flex min-h-7 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left font-medium transition-colors hover:bg-blue-500 hover:text-white focus-visible:bg-blue-500 focus-visible:text-white focus-visible:outline-none"
      >
        <FolderOpen aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span>Reveal in Finder</span>
      </button>

      <hr className="my-1 border-neutral-200/80 dark:border-neutral-800" />

      <button
        type="button"
        onClick={() => handleSelect("trash")}
        className="flex min-h-7 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left font-medium text-red-600 transition-colors hover:bg-red-500 hover:text-white focus-visible:bg-red-500 focus-visible:text-white focus-visible:outline-none dark:text-red-400 dark:hover:bg-red-500 dark:hover:text-white"
      >
        <Trash2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span>Move to Trash</span>
      </button>
    </div>
  );
}
