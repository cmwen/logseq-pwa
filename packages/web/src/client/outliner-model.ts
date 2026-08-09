import {
  analyzeMarkdownCompatibility,
  type Block,
  type BlockEditResult,
  type BlockNode,
  blocksToTree,
  buildWorkspaceIndex,
  createBlock as createCoreBlock,
  createSiblingBlock,
  deleteEmptyBlock,
  flattenBlockTree,
  indentBlock as indentCoreBlock,
  mergeBlockWithPrevious,
  moveBlock as moveCoreBlock,
  normalizeBlockOrder,
  outdentBlock as outdentCoreBlock,
  serializeBlockMarkdown,
  splitBlock as splitCoreBlock,
  toggleBlockCollapsed as toggleCoreBlockCollapsed,
  updateBlockContent as updateCoreBlockContent,
} from '@loam/core';

export type OutlinerBlock = BlockNode;

export interface BlockMutation {
  blocks: OutlinerBlock[];
  focusId?: string;
  caret?: number;
  changed: boolean;
}

export interface OutlinerSafety {
  safe: boolean;
  reasons: string[];
}

/**
 * Determines whether the structured outliner can write a page without changing
 * its Markdown shape. The raw editor is intentionally conservative: a page is
 * only considered safe when it is made of portable bullet blocks and the
 * canonical serializer produces the exact source (including its final newline).
 */
export function assessOutlinerSafety(markdown: string): OutlinerSafety {
  const report = analyzeMarkdownCompatibility(markdown);
  const labels: Record<(typeof report.issues)[number]['kind'], string> = {
    heading: 'headings',
    'ordered-list': 'ordered lists',
    'fenced-code': 'fenced code',
    table: 'tables',
    blockquote: 'block quotes',
    'raw-markdown': 'unsupported interleaving',
  };
  return {
    safe: report.safe,
    reasons: [...new Set(report.issues.map((issue) => labels[issue.kind]))],
  };
}

/** Creates a deterministic, page-scoped identity for a parsed block. */
export function stableBlockId(pagePath: string, content: string, occurrence: number): string {
  const source = `${pagePath}\u0000${content}\u0000${occurrence}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `web_${(hash >>> 0).toString(36)}`;
}

/** Creates one empty root node for a blank editor. */
export function createBlock(content = ''): OutlinerBlock {
  return blocksToTree(createCoreBlock([], { content }).blocks)[0];
}

/** Adapts the canonical flat core model to the recursive Preact render model. */
export function parseMarkdownBlocks(
  markdown: string,
  pagePath = 'page',
  pageTitle = pagePath
): OutlinerBlock[] {
  const blocks = buildWorkspaceIndex([
    { title: pageTitle, path: pagePath, content: markdown },
  ]).blocks;
  return blocks.length ? blocksToTree(blocks) : [createBlock()];
}

/** Serializes the render tree through the canonical core Markdown serializer. */
export function serializeMarkdownBlocks(
  blocks: readonly OutlinerBlock[],
  finalNewline = false
): string {
  return serializeBlockMarkdown(flattenBlockTree(blocks), { finalNewline });
}

export function updateBlockContent(
  blocks: readonly OutlinerBlock[],
  id: string,
  content: string
): OutlinerBlock[] {
  return toTree(updateCoreBlockContent(toFlat(blocks), id, content));
}

export function splitBlock(
  blocks: readonly OutlinerBlock[],
  id: string,
  before: string,
  after: string
): BlockMutation {
  const flat = updateCoreBlockContent(toFlat(blocks), id, `${before}${after}`);
  return fromEditResult(splitCoreBlock(flat, id, before.length), blocks);
}

export function addSiblingBlock(blocks: readonly OutlinerBlock[], id: string): BlockMutation {
  return fromEditResult(createSiblingBlock(toFlat(blocks), id), blocks);
}

export function indentBlock(blocks: readonly OutlinerBlock[], id: string): BlockMutation {
  const flat = toFlat(blocks);
  const next = indentCoreBlock(flat, id);
  return fromStructuralResult(flat, next, id, blocks);
}

export function outdentBlock(blocks: readonly OutlinerBlock[], id: string): BlockMutation {
  const flat = toFlat(blocks);
  const next = outdentCoreBlock(flat, id);
  return fromStructuralResult(flat, next, id, blocks);
}

export function moveBlock(
  blocks: readonly OutlinerBlock[],
  id: string,
  direction: -1 | 1
): BlockMutation {
  const flat = toFlat(blocks);
  const block = getFlatBlock(flat, id);
  const siblings = siblingBlocks(flat, block.parentId);
  const currentIndex = siblings.findIndex((candidate) => candidate.id === id);
  const targetIndex = currentIndex + direction;
  if (targetIndex < 0 || targetIndex >= siblings.length) return unchanged(blocks, id);

  const next = moveCoreBlock(flat, id, { parentId: block.parentId, index: targetIndex });
  return fromStructuralResult(flat, next, id, blocks);
}

export function toggleBlockCollapsed(blocks: readonly OutlinerBlock[], id: string): BlockMutation {
  const flat = toFlat(blocks);
  const next = toggleCoreBlockCollapsed(flat, id);
  return fromStructuralResult(flat, next, id, blocks);
}

export function deleteBlock(
  blocks: readonly OutlinerBlock[],
  id: string,
  preserveChildren = false
): BlockMutation {
  const flat = toFlat(blocks);
  if (preserveChildren) return fromEditResult(deleteEmptyBlock(flat, id), blocks);

  // Core deliberately exposes only safe empty-block deletion. The explicit UI
  // delete action is confirmed first, then removes the selected subtree here.
  const removedIds = collectSubtreeIds(flat, id);
  const index = flat.findIndex((block) => block.id === id);
  const previous = flat[index - 1];
  let next = normalizeBlockOrder(flat.filter((block) => !removedIds.has(block.id)));
  if (!next.length) next = createCoreBlock([]).blocks;
  const focus = (previous && next.find((block) => block.id === previous.id)) ?? next[0];
  return {
    blocks: toTree(next),
    focusId: focus?.id,
    caret: focus?.content.length ?? 0,
    changed: true,
  };
}

export function mergeBlockBackward(blocks: readonly OutlinerBlock[], id: string): BlockMutation {
  return fromEditResult(mergeBlockWithPrevious(toFlat(blocks), id), blocks);
}

export function findBlock(blocks: readonly OutlinerBlock[], id: string): OutlinerBlock | undefined {
  for (const block of blocks) {
    if (block.id === id) return block;
    const child = findBlock(block.children, id);
    if (child) return child;
  }
  return undefined;
}

/** Returns one block as a focused tree while keeping every descendant. */
export function focusBlockTree(blocks: readonly OutlinerBlock[], id: string): OutlinerBlock[] {
  const block = findBlock(blocks, id);
  if (!block) return [];
  const expand = (node: OutlinerBlock): OutlinerBlock => ({
    ...node,
    collapsed: false,
    children: node.children.map(expand),
  });
  return [expand(block)];
}

export function canIndent(blocks: readonly OutlinerBlock[], id: string): boolean {
  const flat = toFlat(blocks);
  const block = getFlatBlock(flat, id);
  return siblingBlocks(flat, block.parentId).findIndex((candidate) => candidate.id === id) > 0;
}

export function canOutdent(blocks: readonly OutlinerBlock[], id: string): boolean {
  return getFlatBlock(toFlat(blocks), id).parentId !== null;
}

export function canMove(blocks: readonly OutlinerBlock[], id: string, direction: -1 | 1): boolean {
  const flat = toFlat(blocks);
  const block = getFlatBlock(flat, id);
  const siblings = siblingBlocks(flat, block.parentId);
  const index = siblings.findIndex((candidate) => candidate.id === id);
  return direction === -1 ? index > 0 : index < siblings.length - 1;
}

/** Moves a complete subtree before, after, or inside another block. */
export function dropBlock(
  blocks: readonly OutlinerBlock[],
  draggedId: string,
  targetId: string,
  placement: 'before' | 'after' | 'inside'
): BlockMutation {
  if (draggedId === targetId) return unchanged(blocks, draggedId);
  const flat = toFlat(blocks);
  getFlatBlock(flat, draggedId);
  const target = getFlatBlock(flat, targetId);
  const subtreeIds = collectSubtreeIds(flat, draggedId);
  if (subtreeIds.has(targetId)) return unchanged(blocks, draggedId);

  const remaining = flat.filter((block) => !subtreeIds.has(block.id));
  const siblings = siblingBlocks(remaining, placement === 'inside' ? target.id : target.parentId);
  const targetIndex =
    placement === 'inside'
      ? siblings.length
      : siblings.findIndex((block) => block.id === target.id) + (placement === 'after' ? 1 : 0);
  if (targetIndex < 0) return unchanged(blocks, draggedId);

  const moving = flat.filter((block) => subtreeIds.has(block.id));
  const next = moveCoreBlock(remaining.concat(moving), draggedId, {
    parentId: placement === 'inside' ? target.id : target.parentId,
    index: targetIndex,
  });
  return fromStructuralResult(flat, next, draggedId, blocks);
}

function toFlat(blocks: readonly OutlinerBlock[]): Block[] {
  return flattenBlockTree(blocks);
}

function toTree(blocks: readonly Block[]): OutlinerBlock[] {
  return blocksToTree(blocks);
}

function siblingBlocks(blocks: readonly Block[], parentId: string | null): Block[] {
  return blocks
    .filter((block) => block.parentId === parentId)
    .sort((left, right) => left.position - right.position);
}

function getFlatBlock(blocks: readonly Block[], id: string): Block {
  const block = blocks.find((candidate) => candidate.id === id);
  if (!block) throw new Error(`Unknown outliner block "${id}".`);
  return block;
}

function fromEditResult(
  result: BlockEditResult,
  previous: readonly OutlinerBlock[]
): BlockMutation {
  const changed =
    serializeForComparison(result.blocks) !== serializeForComparison(toFlat(previous));
  return {
    blocks: toTree(result.blocks),
    focusId: result.focusId ?? undefined,
    caret: result.caretOffset,
    changed,
  };
}

function fromStructuralResult(
  previousFlat: readonly Block[],
  next: readonly Block[],
  focusId: string,
  previousTree: readonly OutlinerBlock[]
): BlockMutation {
  if (serializeForComparison(previousFlat) === serializeForComparison(next)) {
    return unchanged(previousTree, focusId);
  }
  return { blocks: toTree(next), focusId, changed: true };
}

function serializeForComparison(blocks: readonly Block[]): string {
  return JSON.stringify(
    blocks.map(({ id, parentId, position, content, collapsed }) => ({
      id,
      parentId,
      position,
      content,
      collapsed,
    }))
  );
}

function collectSubtreeIds(blocks: readonly Block[], id: string): Set<string> {
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const block of blocks) {
      if (block.parentId && ids.has(block.parentId) && !ids.has(block.id)) {
        ids.add(block.id);
        changed = true;
      }
    }
  }
  return ids;
}

function unchanged(
  blocks: readonly OutlinerBlock[],
  focusId?: string,
  caret?: number
): BlockMutation {
  return { blocks: blocks as OutlinerBlock[], focusId, caret, changed: false };
}
