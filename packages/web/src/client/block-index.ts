import { flattenBlockTree, type PageInput } from '@loam/core';
import { parseMarkdownBlocks } from './outliner-model.js';

/** A compact, persistable block record used by search and contextual backlinks. */
export interface BlockSearchResult {
  blockId: string;
  content: string;
  context?: string;
  pagePath: string;
  pageTitle: string;
  references: string[];
  searchable: string;
}

/** Builds the search and backlink projection for one or more pages. */
export function indexPageBlocks(pages: readonly PageInput[]): BlockSearchResult[] {
  const results: BlockSearchResult[] = [];
  for (const page of pages) {
    const blocks = flattenBlockTree(parseMarkdownBlocks(page.content, page.path, page.title));
    const byId = new Map(blocks.map((block) => [block.id, block]));
    for (const block of blocks) {
      const searchable = [
        page.title,
        block.content,
        ...block.references,
        ...block.tags,
        ...Object.entries(block.properties).flat(),
      ]
        .join(' ')
        .toLocaleLowerCase();
      const parent = block.parentId ? byId.get(block.parentId) : undefined;
      results.push({
        blockId: block.id,
        content: block.content.split('\n')[0] || 'Empty block',
        context: parent?.content.split('\n')[0],
        pagePath: page.path,
        pageTitle: page.title,
        references: [...block.references],
        searchable,
      });
    }
  }
  return results;
}

/** Searches an already-built block projection without reparsing Markdown. */
export function searchPageBlocks(
  index: readonly BlockSearchResult[],
  search: string
): BlockSearchResult[] {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return [];
  return index.filter((result) => result.searchable.includes(query)).slice(0, 40);
}
