import { type Block, type BlockNode, blocksToTree, parseBlockMarkdown } from './blocks.js';
import {
  buildPageIndex,
  extractPageLinks,
  type IndexedPage,
  normalizePageTitle,
  type PageInput,
  pageTitleFromPath,
} from './logseq.js';

/** A block enriched with its owning page and deterministic structural identity. */
export interface IndexedBlock extends Block {
  pageTitle: string;
  pagePath: string;
  pageKey: string;
  /** Zero-based sibling positions from the page root to this block. */
  structuralPath: number[];
}

/** A page in the complete workspace index. */
export interface WorkspacePage extends IndexedPage {
  pageKey: string;
  normalizedTitle: string;
  blocks: IndexedBlock[];
}

/** A normalized page-name collision and the source pages that caused it. */
export interface DuplicatePageGroup {
  normalizedTitle: string;
  pages: PageInput[];
}

/** The pure, rebuildable workspace index. */
export interface WorkspaceIndex {
  pages: WorkspacePage[];
  blocks: IndexedBlock[];
  duplicatePages: DuplicatePageGroup[];
}

/** A block plus its ordered root-to-parent context. */
export interface BlockContext {
  page: WorkspacePage;
  block: IndexedBlock;
  ancestors: IndexedBlock[];
}

/** An incoming page reference with the source block's ancestor context. */
export interface ContextualBacklink extends BlockContext {
  target: string;
  label: string;
}

/** Options for full-text block search. */
export interface BlockSearchOptions {
  /** Limit the number of returned matches. */
  limit?: number;
  /** Restrict matches to one normalized page title. */
  page?: string;
}

function normalizedPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\/+/, '');
}

function pageKey(page: PageInput): string {
  return `${normalizePageTitle(page.title)}\u0000${normalizedPath(page.path).toLocaleLowerCase()}`;
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, '0');
}

/** Creates a deterministic block ID from page identity and zero-based structural position. */
export function deterministicBlockId(identity: string, structuralPath: readonly number[]): string {
  const path = structuralPath.join('.');
  return `b_${hash(`${identity}\u0000${path}`)}`;
}

function structuralPaths(blocks: readonly Block[]): Map<string, number[]> {
  const paths = new Map<string, number[]>();
  const visit = (nodes: readonly BlockNode[], parentPath: readonly number[]): void => {
    nodes.forEach((node, position) => {
      const currentPath = [...parentPath, position];
      paths.set(node.id, currentPath);
      visit(node.children, currentPath);
    });
  };
  visit(blocksToTree(blocks), []);
  return paths;
}

function remapBlockIds(page: PageInput, blocks: readonly Block[]): IndexedBlock[] {
  const paths = structuralPaths(blocks);
  const ids = new Map<string, string>();
  const used = new Set<string>();
  const identity = pageKey(page);

  for (const block of blocks) {
    const structuralPath = paths.get(block.id) ?? [block.position];
    const explicitId = block.properties.id?.trim();
    const id = explicitId || deterministicBlockId(identity, structuralPath);
    if (used.has(id)) {
      throw new Error(`Duplicate block ID "${id}" in page "${page.title}".`);
    }
    used.add(id);
    ids.set(block.id, id);
  }

  return blocks.map((block) => {
    const structuralPath = paths.get(block.id) ?? [block.position];
    return {
      ...block,
      id: ids.get(block.id) ?? block.id,
      parentId: block.parentId === null ? null : (ids.get(block.parentId) ?? null),
      pageTitle: page.title,
      pagePath: page.path,
      pageKey: pageKey(page),
      structuralPath,
      properties: { ...block.properties },
      references: [...block.references],
      tags: [...block.tags],
    };
  });
}

function contextFor(index: WorkspaceIndex, block: IndexedBlock): BlockContext | undefined {
  const page = index.pages.find((candidate) => candidate.pageKey === block.pageKey);
  if (!page) {
    return undefined;
  }
  const byId = new Map(page.blocks.map((candidate) => [candidate.id, candidate]));
  const ancestors: IndexedBlock[] = [];
  let parentId = block.parentId;
  while (parentId !== null) {
    const parent = byId.get(parentId);
    if (!parent) {
      break;
    }
    ancestors.unshift(parent);
    parentId = parent.parentId;
  }
  return { page, block, ancestors };
}

/** Returns all duplicate page names after Logseq normalization, in deterministic order. */
export function findDuplicatePages(pages: readonly PageInput[]): DuplicatePageGroup[] {
  const groups = new Map<string, PageInput[]>();
  for (const page of pages) {
    const key = normalizePageTitle(page.title || page.path);
    const group = groups.get(key) ?? [];
    group.push(page);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([normalizedTitle, group]) => ({
      normalizedTitle,
      pages: [...group].sort((left, right) => left.path.localeCompare(right.path)),
    }));
}

/** Builds a complete page/block index without filesystem, browser, or framework dependencies. */
export function buildWorkspaceIndex(pages: readonly PageInput[]): WorkspaceIndex {
  const pageInputs = pages.map((page) => ({ ...page }));
  const pageIndex = buildPageIndex(pageInputs);
  const indexedPages = pageIndex.map((page) => {
    const normalizedTitle = normalizePageTitle(page.title || pageTitleFromPath(page.path));
    let blockNumber = 0;
    const parsed = parseBlockMarkdown(page.content, {
      idFactory: () => `parsed-${blockNumber++}`,
    });
    const indexedBlocks = remapBlockIds(page, parsed);
    return {
      ...page,
      pageKey: pageKey(page),
      normalizedTitle,
      blocks: indexedBlocks,
    };
  });
  const indexed: WorkspaceIndex = {
    pages: indexedPages,
    blocks: indexedPages.flatMap((page) => page.blocks),
    duplicatePages: findDuplicatePages(pageInputs),
  };
  return indexed;
}

/** Searches block text and metadata, returning every match with all ancestor context. */
export function searchWorkspaceBlocks(
  index: WorkspaceIndex,
  query: string,
  options: BlockSearchOptions = {}
): BlockContext[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) {
    return [];
  }
  const pageFilter = options.page ? normalizePageTitle(options.page) : undefined;
  const results: BlockContext[] = [];
  for (const block of index.blocks) {
    if (pageFilter && normalizePageTitle(block.pageTitle) !== pageFilter) {
      continue;
    }
    const haystack = [
      block.content,
      ...Object.entries(block.properties).flat(),
      ...block.references,
      ...block.tags,
    ]
      .join('\n')
      .toLocaleLowerCase();
    if (!haystack.includes(needle)) {
      continue;
    }
    const context = contextFor(index, block);
    if (context) {
      results.push(context);
    }
    if (options.limit !== undefined && results.length >= Math.max(0, options.limit)) {
      break;
    }
  }
  return results;
}

/** Finds one exact block ID and returns its page and root-to-parent context. */
export function findBlock(index: WorkspaceIndex, blockId: string): BlockContext | undefined {
  const block = index.blocks.find((candidate) => candidate.id === blockId);
  return block ? contextFor(index, block) : undefined;
}

/** Finds incoming page references and includes the source block's ancestor context. */
export function findContextualBacklinks(
  index: WorkspaceIndex,
  targetPage: string
): ContextualBacklink[] {
  const target = normalizePageTitle(targetPage);
  const result: ContextualBacklink[] = [];
  for (const block of index.blocks) {
    const context = contextFor(index, block);
    if (!context) {
      continue;
    }
    const link = block.references
      .map((reference) => ({ target: reference, normalized: normalizePageTitle(reference) }))
      .find((reference) => reference.normalized === target);
    if (link) {
      const written = extractPageLinks(block.content).find(
        (candidate) => normalizePageTitle(candidate.target) === target
      );
      result.push({
        ...context,
        target: link.target,
        label: written?.label || link.target,
      });
    }
  }
  return result;
}

/** American-spelling alias for {@link findContextualBacklinks}. */
export const contextualBacklinks = findContextualBacklinks;

/** Descriptive alias for {@link findContextualBacklinks}. */
export const getContextualBacklinks = findContextualBacklinks;

/** Short alias for {@link searchWorkspaceBlocks}. */
export const searchBlocks = searchWorkspaceBlocks;

/** Descriptive alias for {@link findBlock}. */
export const lookupBlock = findBlock;

/** Descriptive alias for {@link findDuplicatePages}. */
export const findDuplicateNormalizedPages = findDuplicatePages;
