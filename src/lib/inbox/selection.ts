interface MoveRangeSelectionInput {
  orderedIds: string[];
  anchorId: string | null;
  focusId: string | null;
  direction: -1 | 1;
}

interface MoveRangeSelectionResult {
  selectedIds: Set<string>;
  focusId: string | null;
}

export function selectInclusiveRange(
  orderedIds: string[],
  anchorId: string,
  focusId: string,
): Set<string> {
  const anchorIndex = orderedIds.indexOf(anchorId);
  const focusIndex = orderedIds.indexOf(focusId);
  if (anchorIndex < 0 || focusIndex < 0) return new Set([focusId]);

  const start = Math.min(anchorIndex, focusIndex);
  const end = Math.max(anchorIndex, focusIndex);
  return new Set(orderedIds.slice(start, end + 1));
}

export function moveRangeSelection({
  orderedIds,
  anchorId,
  focusId,
  direction,
}: MoveRangeSelectionInput): MoveRangeSelectionResult {
  if (orderedIds.length === 0) {
    return { selectedIds: new Set(), focusId: null };
  }

  const resolvedAnchor =
    anchorId && orderedIds.includes(anchorId) ? anchorId : orderedIds[0];
  const currentFocus =
    focusId && orderedIds.includes(focusId) ? focusId : resolvedAnchor;
  const currentIndex = orderedIds.indexOf(currentFocus);
  const nextIndex = Math.max(
    0,
    Math.min(orderedIds.length - 1, currentIndex + direction),
  );
  const nextFocus = orderedIds[nextIndex];

  return {
    selectedIds: selectInclusiveRange(
      orderedIds,
      resolvedAnchor,
      nextFocus,
    ),
    focusId: nextFocus,
  };
}

export function toggleSelection(
  selectedIds: ReadonlySet<string>,
  conversationId: string,
): Set<string> {
  const next = new Set(selectedIds);
  if (next.has(conversationId)) next.delete(conversationId);
  else next.add(conversationId);
  return next;
}
