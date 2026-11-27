import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChangelogEntry } from "../../../lib/changelog";
import { useSweepStore } from "../../../store/useSweepStore";
import { TitleBar } from "../../layout/TitleBar";
import { AboutModal } from "../AboutModal";

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
});
