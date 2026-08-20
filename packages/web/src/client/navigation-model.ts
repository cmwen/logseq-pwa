export interface BlockNavigationTarget {
  blockId: string;
  pagePath: string;
  pageTitle: string;
  query: string;
}

/** Keeps block navigation data together so page context cannot be lost. */
export function createBlockNavigationTarget(
  page: { path: string; title: string },
  blockId: string,
  query: string
): BlockNavigationTarget {
  return {
    blockId,
    pagePath: page.path,
    pageTitle: page.title,
    query: query.trim(),
  };
}

export function rememberSearchQuery(history: readonly string[], query: string): string[] {
  const value = query.trim();
  if (!value) return [...history];
  return [value, ...history.filter((item) => item !== value)].slice(0, 20);
}

export interface CommandPaletteItem {
  description: string;
  label: string;
}

export function filterCommandPaletteItems<T extends CommandPaletteItem>(
  items: readonly T[],
  query: string
): T[] {
  const value = query.trim().toLocaleLowerCase();
  if (!value) return [...items];
  return items.filter((item) =>
    `${item.label} ${item.description}`.toLocaleLowerCase().includes(value)
  );
}

/** A shared DOM hook name for view and editor focus/scroll behavior. */
export function blockDomId(blockId: string): string {
  return `page-block-${blockId}`;
}
