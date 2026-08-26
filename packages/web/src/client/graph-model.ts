import { splitFrontmatter } from '@loam/core';

/** The small part of a local page needed by graph views. */
export interface GraphPage {
  title: string;
  path: string;
  content: string;
}

/** Structural alias for callers that already use the LocalPage name. */
export type LocalPageLike = GraphPage;

/** A tag occurrence, retaining the written spelling and character offset. */
export interface HashtagReference {
  index: number;
  raw: string;
  tag: string;
}

function markdownBody(markdown: string): string {
  return splitFrontmatter(markdown).body.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function isMarkdownHeading(line: string): boolean {
  return /^ {0,3}#{1,6}(?:\s|$)/u.test(line);
}

/**
 * Finds canonical `@tags` / `@[[multi word tags]]` and legacy `#tags`.
 *
 * Markdown heading markers are masked because their leading `#` is syntax,
 * not a tag; explicit tags later in a heading still count. References are
 * returned in document order and repeats are retained for occurrence counts.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The ordered scanner preserves source offsets while excluding frontmatter, headings, inline code, and fenced code.
export function extractHashtagReferenceDetails(markdown: string): HashtagReference[] {
  const references: HashtagReference[] = [];
  const body = markdownBody(markdown);
  let offset = 0;
  let fenceMarker = '';

  for (const line of body.split('\n')) {
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1] ?? '';
    if (fence) {
      const marker = fence[0] ?? '';
      if (!fenceMarker) fenceMarker = marker;
      else if (marker === fenceMarker) fenceMarker = '';
    } else if (!fenceMarker) {
      let searchable = line
        .replace(/`[^`\n]*`/gu, (value) => ' '.repeat(value.length))
        .replace(/\b(?:https?:\/\/|mailto:)\S+/giu, (value) => ' '.repeat(value.length));
      if (isMarkdownHeading(line)) {
        searchable = searchable.replace(/^ {0,3}#{1,6}(?=\s|$)/u, (value) =>
          ' '.repeat(value.length)
        );
      }
      const pattern =
        /(^|[^\p{L}\p{N}_@#])((?:@|#)(?:\[\[([^\]\n]+)\]\]|[\p{L}\p{N}_][\p{L}\p{N}_/-]*))/gu;
      for (const match of searchable.matchAll(pattern)) {
        const raw = match[2] ?? '';
        const tag = (match[3] ?? raw.slice(1)).trim();
        if (tag)
          references.push({
            index: offset + (match.index ?? 0) + (match[1]?.length ?? 0),
            raw,
            tag,
          });
      }
    }
    offset += line.length + 1;
  }

  return references;
}

/** Returns unique, case-normalized tags in written order. */
export function extractHashtags(markdown: string): string[] {
  return [
    ...new Set(
      extractHashtagReferenceDetails(markdown).map((reference) => reference.tag.toLocaleLowerCase())
    ),
  ];
}

/** Alias that makes the relationship with page tags explicit at call sites. */
export const extractTagReferences = extractHashtags;

/** Extracts unique canonical or legacy tags from one page. */
export function extractPageTags(page: Pick<GraphPage, 'content'>): string[] {
  return extractHashtags(page.content);
}

export interface TagSummary {
  /** Canonical, case-folded tag name (without its `@` or legacy `#` prefix). */
  tag: string;
  /** Number of occurrences across all page contents. */
  count: number;
  /** Page titles containing the tag, in first-seen order. */
  pages: string[];
  /** Matching page paths, in the same order as {@link pages}. */
  pagePaths: string[];
  /** Number of distinct pages containing the tag. */
  pageCount: number;
}

/** Builds deterministic tag counts and page membership for a local graph. */
export function buildTagSummaries(pages: readonly GraphPage[]): TagSummary[] {
  const summaries = new Map<string, TagSummary>();
  for (const page of pages) {
    for (const reference of extractHashtagReferenceDetails(page.content)) {
      const tag = reference.tag.toLocaleLowerCase();
      const summary = summaries.get(tag) ?? {
        count: 0,
        pageCount: 0,
        pagePaths: [],
        pages: [],
        tag,
      };
      summary.count += 1;
      if (!summary.pagePaths.includes(page.path)) {
        summary.pages.push(page.title);
        summary.pagePaths.push(page.path);
        summary.pageCount += 1;
      }
      summaries.set(tag, summary);
    }
  }
  return [...summaries.values()].sort((left, right) => left.tag.localeCompare(right.tag));
}

/** Short alias for consumers that call the result a tag index. */
export const summarizeTags = buildTagSummaries;
export const tagSummaries = buildTagSummaries;

function pathSegments(path: string): string[] {
  const withoutExtension = decodeURIComponent(path).replace(/\.md$/iu, '').replaceAll('\\', '/');
  const segments = withoutExtension.split('/').filter(Boolean);
  if (segments[0]?.toLocaleLowerCase() === 'pages') segments.shift();
  if (segments[0]?.toLocaleLowerCase() === 'journals') segments.shift();
  return segments
    .map((segment) => segment.replaceAll('___', '/').replaceAll('_', ' '))
    .flatMap((segment) => segment.split('/'))
    .filter(Boolean);
}

function namespaceSegments(page: GraphPage): string[] {
  const title = page.title.trim();
  const titleSegments = title
    ? title
        .split('/')
        .map((part) => part.trim())
        .filter(Boolean)
    : [];
  const path = pathSegments(page.path);
  // A directory-based graph can carry namespace information even when its
  // page title is only the basename. Prefer explicit title namespaces.
  if (titleSegments.length > 1) return titleSegments;
  if (path.length > 1 && titleSegments.length <= 1) {
    const basename = titleSegments[0] ?? path[path.length - 1];
    if (path[path.length - 1]?.toLocaleLowerCase() === basename.toLocaleLowerCase()) return path;
  }
  return titleSegments.length ? titleSegments : path;
}

export interface PageHierarchyNode {
  title: string;
  path?: string;
  page?: GraphPage;
  synthetic: boolean;
  depth: number;
  breadcrumbs: string[];
  parentTitle: string | null;
  children: PageHierarchyNode[];
}

export interface PageHierarchy {
  roots: PageHierarchyNode[];
  nodes: PageHierarchyNode[];
}

function hierarchyKey(title: string): string {
  return title.replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
}

/** Infers namespace and directory parent/child relationships for pages. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This single pass intentionally assembles synthetic ancestors and links.
export function buildPageHierarchy(pages: readonly GraphPage[]): PageHierarchy {
  const nodesByKey = new Map<string, PageHierarchyNode>();
  const segmentsByPage = pages.map((page) => ({ page, segments: namespaceSegments(page) }));

  for (const { page, segments } of segmentsByPage) {
    for (let index = 0; index < segments.length; index += 1) {
      const title = segments.slice(0, index + 1).join('/');
      const key = hierarchyKey(title);
      if (!nodesByKey.has(key)) {
        nodesByKey.set(key, {
          breadcrumbs: segments.slice(0, index + 1),
          children: [],
          depth: index,
          parentTitle: index ? segments.slice(0, index).join('/') : null,
          synthetic: true,
          title,
        });
      }
    }
    const fullTitle = segments.join('/');
    const node = nodesByKey.get(hierarchyKey(fullTitle));
    if (node) {
      node.page = page;
      node.path = page.path;
      node.synthetic = false;
    }
  }

  const nodes = [...nodesByKey.values()].sort((left, right) =>
    left.title.localeCompare(right.title)
  );
  for (const node of nodes) {
    if (node.parentTitle) {
      const parent = nodesByKey.get(hierarchyKey(node.parentTitle));
      if (parent && !parent.children.includes(node)) parent.children.push(node);
    }
    node.children.sort((left, right) => left.title.localeCompare(right.title));
  }
  return {
    nodes,
    roots: nodes.filter(
      (node) => !node.parentTitle || !nodesByKey.has(hierarchyKey(node.parentTitle))
    ),
  };
}

export const inferPageHierarchy = buildPageHierarchy;
export const createPageHierarchy = buildPageHierarchy;

/** Returns breadcrumb labels for a namespace title. */
export function pageBreadcrumbs(title: string): string[] {
  const segments = title
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  return segments;
}

const MONTHS: Record<string, number> = {
  apr: 3,
  april: 3,
  aug: 7,
  august: 7,
  dec: 11,
  december: 11,
  feb: 1,
  february: 1,
  jan: 0,
  january: 0,
  jul: 6,
  july: 6,
  jun: 5,
  june: 5,
  mar: 2,
  march: 2,
  may: 4,
  nov: 10,
  november: 10,
  oct: 9,
  october: 9,
  sep: 8,
  september: 8,
};

function dateFromParts(year: number, month: number, day: number): Date | null {
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}

/** Parses one ISO date or Logseq-friendly long date into a UTC date-only value. */
export function parseDatePrimitive(value: string): Date | null {
  const text =
    value
      .trim()
      .replace(/^\[\[|\]\]$/gu, '')
      .split('|', 1)[0]
      ?.trim() ?? '';
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (iso) return dateFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const long = text.match(
    /^(?:[A-Za-z]{3,9},?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(\d{4})$/iu
  );
  if (!long) return null;
  const month = MONTHS[long[2]?.toLocaleLowerCase() ?? ''];
  return month === undefined ? null : dateFromParts(Number(long[3]), month + 1, Number(long[1]));
}

export interface DatePrimitive {
  raw: string;
  iso: string;
  date: Date;
  index: number;
  source: 'link' | 'token';
}

/** Finds `[[date]]` links and bare ISO date tokens in markdown. */
export function extractDatePrimitives(markdown: string): DatePrimitive[] {
  const body = markdownBody(markdown);
  const found: DatePrimitive[] = [];
  const seen = new Set<string>();
  const add = (raw: string, index: number, source: DatePrimitive['source']) => {
    const date = parseDatePrimitive(raw);
    if (!date) return;
    const key = `${index}:${raw}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ date, index, iso: date.toISOString().slice(0, 10), raw, source });
  };
  for (const match of body.matchAll(/\[\[([^\]\n]+)\]\]/gu)) {
    add(match[0] ?? '', match.index ?? 0, 'link');
  }
  for (const match of body.matchAll(/(?<![\d-])(\d{4}-\d{2}-\d{2})(?![\d-])/gu)) {
    const index = match.index ?? 0;
    // A linked date was already recorded above; do not report its inner text
    // as a second bare token.
    if (body[index - 2] === '[' || body[index + (match[1]?.length ?? 0)] === ']') continue;
    add(match[1] ?? '', index, 'token');
  }
  return found.sort((left, right) => left.index - right.index);
}

/** Extracts a journal date from conventional `journals/YYYY_MM_DD.md` pages. */
export function journalDateFromPath(path: string): Date | null {
  const match = path.match(/(?:^|\/)journals\/(\d{4})[_-](\d{2})[_-](\d{2})\.md$/iu);
  return match ? dateFromParts(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

export function parseJournalPageDate(page: Pick<GraphPage, 'path' | 'title'>): Date | null {
  return (
    journalDateFromPath(page.path) ??
    (/(?:^|\/)journals\//iu.test(page.path) ? parseDatePrimitive(page.title) : null)
  );
}

export const journalDateForPage = parseJournalPageDate;
export const parseDate = parseDatePrimitive;
export const extractDates = extractDatePrimitives;
