/**
 * Counts for a filter's options (status chips, genre or year selects): how many items each value would show.
 * `keep` is the page's filter with this one filter left out, so the count matches the list you get after picking
 * the value. Counting over the whole list instead made "Watched in 2026 (27)" show 21 titles with Watched on.
 * `picked` stays in the result even at 0, so the selected option doesn't vanish from its select.
 */
export function facetCounts<T, K extends string | number>(
  items: readonly T[],
  keep: (item: T) => boolean,
  keysOf: (item: T) => readonly (K | null | undefined)[],
  picked?: K | null,
): Map<K, number> {
  const counts = new Map<K, number>();
  for (const item of items) {
    if (!keep(item)) continue;
    // A Set: a book listing one genre twice is still one book.
    for (const key of new Set(keysOf(item))) if (key != null && key !== "") counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (picked != null && picked !== "" && !counts.has(picked)) counts.set(picked, 0);
  return counts;
}
