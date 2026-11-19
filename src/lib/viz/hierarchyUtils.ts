import { hierarchy, type HierarchyNode } from "d3-hierarchy";
import type { NodeKey, SubtreeNodeDto } from "../ipc/types";

export const SYNTHETIC_OTHER_PREFIX = "__other__:";

export function isSyntheticOtherId(id: NodeKey): boolean {
  return id.startsWith(SYNTHETIC_OTHER_PREFIX);
}

/**
 * Determine whether a `SubtreeNodeDto` should expand into hierarchy children.
 * Returns `false` when a directory has no children or only zero-byte children
 * (and no `aggregatedOtherBytes`), so the directory itself retains its leaf area.
 */
function hasEffectiveChildren(node: SubtreeNodeDto): boolean {
  if (Number.isFinite(node.aggregatedOtherBytes) && node.aggregatedOtherBytes > 0) {
    return true;
  }
  const children = node.children;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child && Number.isFinite(child.physicalBytes) && child.physicalBytes > 0) {
      return true;
    }
  }
  return false;
}

function createSyntheticOtherNode(parent: SubtreeNodeDto): SubtreeNodeDto {
  const otherBytes = Math.max(0, parent.aggregatedOtherBytes);
  return {
    id: `${SYNTHETIC_OTHER_PREFIX}${parent.id}`,
    name: "Other",
    path: parent.path === "/" ? "/Other" : `${parent.path}/Other`,
    isDir: false,
    isHardlinkDup: false,
    physicalBytes: otherBytes,
    logicalBytes: otherBytes,
    fileCount: 0,
    category: "other",
    children: [],
    hasMoreChildren: false,
    aggregatedOtherBytes: 0,
  };
}

/**
 * Build a weighted, descending-sorted `d3-hierarchy` tree from `SubtreeNodeDto`.
 *
 * - Weights strictly by `physicalBytes` (APFS physical-size-first invariant).
 * - Appends a synthetic `"Other"` leaf when `aggregatedOtherBytes > 0` so area
 *   and angular proportions match real disk usage without double-counting.
 * - Avoids cloning child arrays when `aggregatedOtherBytes <= 0` for 50k+ node speed.
 */
export function buildWeightedHierarchy(
  subtree: SubtreeNodeDto,
): HierarchyNode<SubtreeNodeDto> {
  const root = hierarchy<SubtreeNodeDto>(subtree, (node) => {
    if (!hasEffectiveChildren(node)) {
      return null;
    }
    if (Number.isFinite(node.aggregatedOtherBytes) && node.aggregatedOtherBytes > 0) {
      const synthetic = createSyntheticOtherNode(node);
      if (node.children.length === 0) {
        return [synthetic];
      }
      return [...node.children, synthetic];
    }
    return node.children;
  });

  root
    .sum((d) => {
      if (hasEffectiveChildren(d)) {
        return 0;
      }
      return Number.isFinite(d.physicalBytes) && d.physicalBytes > 0
        ? d.physicalBytes
        : 0;
    })
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  return root;
}
