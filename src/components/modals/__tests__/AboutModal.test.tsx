import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChangelogEntry } from "../../../lib/changelog";
import { useSweepStore } from "../../../store/useSweepStore";
import { TitleBar } from "../../layout/TitleBar";
import { AboutModal } from "../AboutModal";

const mockGetVersion = vi.fn<() => Promise<string>>(async () => "0.2.5");

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => mockGetVersion(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => {}),
}));

const SAMPLE_ENTRIES: ChangelogEntry[] = [
  {
    version: "0.2.0",
    date: "2026-12-01",
    url: "https://github.com/seanr89/mac-sweep/releases/tag/v0.2.0",
    sections: [
      {
        title: "Features",
        items: ["Add automated release workflow and `AboutModal`"],
      },
      {
        title: "Bug Fixes",
        items: ["**cleanup:** handle edge cases cleanly"],
      },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-11-24",
    url: "https://github.com/seanr89/mac-sweep/releases/tag/v0.1.0",
    sections: [
      {
        title: "Features",
        items: ["Initial APFS disk space analyzer release"],
      },
    ],
  },
];

afterEach(() => {
  cleanup();
  useSweepStore.getState().resetStore();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  mockGetVersion.mockReset();
  mockGetVersion.mockResolvedValue("0.2.5");
});

describe("AboutModal", () => {
  it("renders app name, version badge, and latest versioned changes on open", () => {
    const onClose = vi.fn();

    render(
      <AboutModal
        open
        onClose={onClose}
        version="0.2.0"
        entries={SAMPLE_ENTRIES}
      />,
    );

    expect(
      screen.getByRole("heading", { name: /^Mac Sweep$/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("v0.2.0").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Latest Versioned Changes")).toBeInTheDocument();
    expect(screen.getByText("Released 2026-12-01")).toBeInTheDocument();
    expect(
      screen.getByText(/Add automated release workflow/i),
    ).toBeInTheDocument();
    expect(screen.getByText("AboutModal")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("switches to full changelog via 'View Full Changelog' and tab controls", () => {
    const onClose = vi.fn();

    render(
      <AboutModal
        open
        onClose={onClose}
        version="0.2.0"
        entries={SAMPLE_ENTRIES}
      />,
    );

    // Initially older 0.1.0 entry is not shown in What's New
    expect(
      screen.queryByText(/Initial APFS disk space analyzer release/i),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /View Full Changelog/i }),
    );

    const fullTab = screen.getByRole("tab", { name: /Full Changelog/i });
    expect(fullTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("2026-12-01")).toBeInTheDocument();
    expect(screen.getByText("2026-11-24")).toBeInTheDocument();
    expect(
      screen.getByText(/Initial APFS disk space analyzer release/i),
    ).toBeInTheDocument();

    // Switch back to What's New tab
    fireEvent.click(screen.getByRole("tab", { name: /What's New/i }));
    expect(screen.getByText("Latest Versioned Changes")).toBeInTheDocument();
  });

  it("invokes onClose when clicking Done or the close icon button", () => {
    const onClose = vi.fn();

    render(
      <AboutModal
        open
        onClose={onClose}
        version="0.2.0"
        entries={SAMPLE_ENTRIES}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Done$/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /Close About dialog/i }),
    );

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("opens from TitleBar About button via Zustand store", () => {
    expect(useSweepStore.getState().aboutModalOpen).toBe(false);

    render(<TitleBar />);
    fireEvent.click(screen.getByRole("button", { name: /About Mac Sweep/i }));

    expect(useSweepStore.getState().aboutModalOpen).toBe(true);

    useSweepStore.getState().closeAboutModal();
    expect(useSweepStore.getState().aboutModalOpen).toBe(false);
  });

  it("moves DOM focus and aria-selected across tabs on ArrowRight, ArrowLeft, Home, and End", () => {
    const onClose = vi.fn();

    render(
      <AboutModal
        open
        onClose={onClose}
        version="0.2.0"
        entries={SAMPLE_ENTRIES}
      />,
    );

    const tablist = screen.getByRole("tablist", { name: /About sections/i });
    const whatsNewTab = screen.getByRole("tab", { name: /What's New/i });
    const fullTab = screen.getByRole("tab", { name: /Full Changelog/i });

    whatsNewTab.focus();
    expect(document.activeElement).toBe(whatsNewTab);

    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(fullTab).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(fullTab);

    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(whatsNewTab).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(whatsNewTab);

    fireEvent.keyDown(tablist, { key: "End" });
    expect(fullTab).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(fullTab);

    fireEvent.keyDown(tablist, { key: "Home" });
    expect(whatsNewTab).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(whatsNewTab);
  });

  it("closes on dialog backdrop click but not when clicking inside modal content", () => {
    const onClose = vi.fn();

    render(
      <AboutModal
        open
        onClose={onClose}
        version="0.2.0"
        entries={SAMPLE_ENTRIES}
      />,
    );

    fireEvent.click(screen.getByRole("heading", { name: /^Mac Sweep$/i }));
    expect(onClose).not.toHaveBeenCalled();

    const dialog = document.querySelector("dialog");
    expect(dialog).not.toBeNull();
    fireEvent.click(dialog!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("resolves live Tauri getVersion() when running inside Tauri runtime", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    mockGetVersion.mockResolvedValueOnce("0.9.4");

    render(
      <AboutModal open onClose={vi.fn()} entries={SAMPLE_ENTRIES} />,
    );

    await waitFor(() => {
      expect(screen.getByText("v0.9.4")).toBeInTheDocument();
    });
    expect(mockGetVersion).toHaveBeenCalledTimes(1);
  });

  it("renders safe inline markdown links, strips unsafe protocols, and exposes release header link", () => {
    const entries: ChangelogEntry[] = [
      {
        version: "0.2.0",
        date: "2026-12-01",
        url: "https://github.com/seanr89/mac-sweep/releases/tag/v0.2.0",
        sections: [
          {
            title: "Features",
            items: [
              "See [Release Notes](https://github.com/seanr89/mac-sweep) and [Unsafe](javascript:alert(1))",
            ],
          },
        ],
      },
    ];

    render(
      <AboutModal
        open
        onClose={vi.fn()}
        version="0.2.0"
        entries={entries}
      />,
    );

    const safeLink = screen.getByRole("link", { name: "Release Notes" });
    expect(safeLink).toHaveAttribute(
      "href",
      "https://github.com/seanr89/mac-sweep",
    );
    expect(safeLink).toHaveAttribute("rel", "noopener noreferrer");

    expect(screen.getByText(/Unsafe/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Unsafe" })).toBeNull();

    const releaseHeaderLink = screen.getByRole("link", {
      name: /View v0\.2\.0 release notes/i,
    });
    expect(releaseHeaderLink).toHaveAttribute(
      "href",
      "https://github.com/seanr89/mac-sweep/releases/tag/v0.2.0",
    );
  });
});
