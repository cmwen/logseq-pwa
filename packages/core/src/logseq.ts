export interface PageLink {
  target: string;
  label: string;
}

export interface PageInput {
  title: string;
  path: string;
  content: string;
}

export interface IndexedPage extends PageInput {
  links: PageLink[];
  backlinks: string[];
}

/** Normalizes Logseq page names so links remain stable across file-name styles. */
export function normalizePageTitle(title: string): string {
  return decodeURIComponent(title)
    .replace(/\.md$/i, '')
    .replaceAll('_', ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

/** Derives a display name from a markdown path when a page has no explicit title. */
export function pageTitleFromPath(path: string): string {
  const filename = path.split('/').pop() ?? path;
  return decodeURIComponent(filename)
    .replace(/\.md$/i, '')
    .replaceAll('_', ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Reads Logseq's [[Page Name]] and [[Page Name|alias]] references from markdown. */
export function extractPageLinks(content: string): PageLink[] {
  const links: PageLink[] = [];
  const linkPattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

  for (const match of content.matchAll(linkPattern)) {
    const target = match[1]?.trim();
    if (!target) {
      continue;
    }

    links.push({
      target,
      label: match[2]?.trim() || target,
    });
  }

  return links;
}

/** Builds outgoing-link and backlink relationships for a collection of pages. */
export function buildPageIndex(pages: PageInput[]): IndexedPage[] {
  const backlinksByKey = new Map<string, Set<string>>();
  for (const page of pages) {
    for (const link of extractPageLinks(page.content)) {
      const key = normalizePageTitle(link.target);
      const backlinks = backlinksByKey.get(key) ?? new Set<string>();
      backlinks.add(page.title);
      backlinksByKey.set(key, backlinks);
    }
  }

  return pages.map((page) => ({
    ...page,
    links: extractPageLinks(page.content),
    backlinks: [...(backlinksByKey.get(normalizePageTitle(page.title)) ?? [])]
      .filter((title) => title !== page.title)
      .sort((a, b) => a.localeCompare(b)),
  }));
}
