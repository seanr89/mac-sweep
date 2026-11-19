import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockScanStore } from "../../../lib/ipc/mockData";
import { VizContainer } from "../VizContainer";

afterEach(() => {
  cleanup();
});

describe("VizContainer", () => {
  it("renders a clean empty state when subtree is null", () => {
    render(
      <VizContainer
        subtree={null}
        vizMode="treemap"
        onVizModeChange={vi.fn()}
        breadcrumbs={[]}
        selectedNodeId={null}
        hoveredNodeId={null}
        onHoverNode={vi.fn()}
        onSelectNode={vi.fn()}
        onDrillDown={vi.fn()}
        onNavigateBreadcrumb={vi.fn()}
      />,
    );

    expect(screen.getByText("No Disk Scan Active")).toBeTruthy();
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("renders breadcrumbs, segmented mode toggle, category legend, and a single Canvas", () => {
    const store = createMockScanStore("/Users/alex");
    const subtree = store.getTreemapSubtree(store.rootId, 5, 40);
    const firstChild = subtree.children[0];
    expect(firstChild).toBeDefined();
    const breadcrumbs = firstChild
      ? store.getNodeBreadcrumbs(firstChild.id)
      : store.getNodeBreadcrumbs(store.rootId);

    const onVizModeChange = vi.fn();
    const onNavigateBreadcrumb = vi.fn();

    const { rerender } = render(
      <VizContainer
        subtree={subtree}
        vizMode="treemap"
        onVizModeChange={onVizModeChange}
        breadcrumbs={breadcrumbs}
        selectedNodeId={null}
        hoveredNodeId={null}
        onHoverNode={vi.fn()}
        onSelectNode={vi.fn()}
        onDrillDown={vi.fn()}
        onNavigateBreadcrumb={onNavigateBreadcrumb}
      />,
    );

    // Strictly a single <canvas> element (zero per-node DOM/SVG elements)
    expect(document.querySelectorAll("canvas")).toHaveLength(1);

    // Clicking first breadcrumb triggers navigation
    const rootCrumb = breadcrumbs[0];
    expect(rootCrumb).toBeDefined();
    if (rootCrumb) {
      fireEvent.click(screen.getByRole("button", { name: rootCrumb.name }));
      expect(onNavigateBreadcrumb).toHaveBeenCalledWith(rootCrumb.id);
    }

    // Segmented mode toggle switches to Sunburst
    const treemapBtn = screen.getByRole("button", { name: "Treemap" });
    const sunburstBtn = screen.getByRole("button", { name: "Sunburst" });
    expect(treemapBtn.getAttribute("aria-pressed")).toBe("true");
    expect(sunburstBtn.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(sunburstBtn);
    expect(onVizModeChange).toHaveBeenCalledWith("sunburst");

    // Re-render in Sunburst mode
    rerender(
      <VizContainer
        subtree={subtree}
        vizMode="sunburst"
        onVizModeChange={onVizModeChange}
        breadcrumbs={breadcrumbs}
        selectedNodeId={null}
        hoveredNodeId={null}
        onHoverNode={vi.fn()}
        onSelectNode={vi.fn()}
        onDrillDown={vi.fn()}
        onNavigateBreadcrumb={onNavigateBreadcrumb}
      />,
    );
    expect(document.querySelectorAll("canvas")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Sunburst" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
