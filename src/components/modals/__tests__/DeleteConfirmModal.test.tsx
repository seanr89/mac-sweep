import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeleteResult, NodeSummaryDto } from "../../../lib/ipc/types";
import { DeleteConfirmModal } from "../DeleteConfirmModal";

const SAMPLE_TARGETS: NodeSummaryDto[] = [
  {
    id: "9007199254741042",
    parentId: "9007199254741001",
    name: "target",
    path: "/Users/alex/Projects/mac-sweep/target",
    isDir: true,
    isSymlink: false,
    isHardlinkDup: false,
    permissionDenied: false,
    physicalBytes: 4_250_000_000,
    logicalBytes: 4_300_000_000,
    fileCount: 8910,
    dirCount: 540,
    modifiedSecs: 1_763_500_000,
    category: "code",
    percentOfParent: 45,
  },
];

afterEach(() => {
  cleanup();
});

describe("DeleteConfirmModal", () => {
  it("defaults to Finder Trash mode and invokes onConfirm('trash')", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <DeleteConfirmModal
        open
        targets={SAMPLE_TARGETS}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    expect(
      screen.getByRole("heading", { name: /Move 1 item to Trash/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("/Users/alex/Projects/mac-sweep/target"),
    ).toBeInTheDocument();

    const permanentToggle = screen.getByLabelText(
      /Delete permanently \(bypass Finder Trash\)/i,
    ) as HTMLInputElement;
    expect(permanentToggle.checked).toBe(false);

    const confirmButton = screen.getByRole("button", {
      name: /^Move to Trash$/i,
    });
    expect(confirmButton).toBeEnabled();

    fireEvent.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("trash");
  });

  it("disables permanent deletion until explicit acknowledgment checkbox is checked", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <DeleteConfirmModal
        open
        targets={SAMPLE_TARGETS}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    // Toggle into permanent mode
    const permanentToggle = screen.getByLabelText(
      /Delete permanently \(bypass Finder Trash\)/i,
    );
    fireEvent.click(permanentToggle);

    expect(
      screen.getByText(/Permanent deletion cannot be undone/i),
    ).toBeInTheDocument();

    const deleteButton = screen.getByRole("button", {
      name: /^Delete Permanently$/i,
    });
    expect(deleteButton).toBeDisabled();

    // Clicking disabled button must NOT invoke callback
    fireEvent.click(deleteButton);
    expect(onConfirm).not.toHaveBeenCalled();

    // Check explicit acknowledgment checkbox
    const ackCheckbox = screen.getByLabelText(
      /I understand these items cannot be recovered from Trash/i,
    );
    fireEvent.click(ackCheckbox);

    expect(deleteButton).toBeEnabled();
    fireEvent.click(deleteButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("permanent");
  });

  it("resets back to Finder Trash mode whenever closed and reopened", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    const { rerender } = render(
      <DeleteConfirmModal
        open
        targets={SAMPLE_TARGETS}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    // Enable permanent deletion + acknowledgment
    fireEvent.click(
      screen.getByLabelText(/Delete permanently \(bypass Finder Trash\)/i),
    );
    fireEvent.click(
      screen.getByLabelText(
        /I understand these items cannot be recovered from Trash/i,
      ),
    );
    expect(
      screen.getByRole("button", { name: /^Delete Permanently$/i }),
    ).toBeEnabled();

    // Close modal
    rerender(
      <DeleteConfirmModal
        open={false}
        targets={[]}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    // Reopen modal — MUST reset to Finder Trash ("trash")
    rerender(
      <DeleteConfirmModal
        open
        targets={SAMPLE_TARGETS}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    const permanentToggle = screen.getByLabelText(
      /Delete permanently \(bypass Finder Trash\)/i,
    ) as HTMLInputElement;
    expect(permanentToggle.checked).toBe(false);
    expect(
      screen.getByRole("button", { name: /^Move to Trash$/i }),
    ).toBeEnabled();
    expect(
      screen.queryByLabelText(
        /I understand these items cannot be recovered from Trash/i,
      ),
    ).not.toBeInTheDocument();
  });

  it("renders ProtectedPathGuard and deletion failure items clearly", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    const resultWithFailure: DeleteResult = {
      deletedNodeIds: [],
      reclaimedPhysicalBytes: 0,
      reclaimedLogicalBytes: 0,
      failures: [
        {
          nodeId: "9007199254741001",
          path: "/System",
          code: "PROTECTED_PATH",
          reason: "Refusing to modify protected path: /System",
        },
      ],
      updatedRoot: null,
    };

    render(
      <DeleteConfirmModal
        open
        targets={SAMPLE_TARGETS}
        lastResult={resultWithFailure}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("PROTECTED_PATH")).toBeInTheDocument();
    expect(
      screen.getByText(/Refusing to modify protected path: \/System/i),
    ).toBeInTheDocument();
  });
});
