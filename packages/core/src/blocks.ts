import { extractPageLinks } from './logseq.js';

export interface Block {
  id: string;
  parentId: string | null;
  position: number;
  content: string;
  collapsed: boolean;
  properties: Record<string, string>;
  references: string[];
  tags: string[];
}

export interface BlockNode extends Block {
  children: BlockNode[];
}

export interface ParseBlockMarkdownOptions {
  idFactory?: () => string;
  tabSize?: number;
}

export interface SerializeBlockMarkdownOptions {
  finalNewline?: boolean;
  indentSize?: number;
}

export interface BlockEditResult {
  blocks: Block[];
  focusId: string | null;
  caretOffset: number;
}

export interface CreateBlockOptions {
  parentId?: string | null;
  position?: number;
  content?: string;
  id?: string;
}

export interface MoveBlockTarget {
  parentId: string | null;
  index: number;
}

export class BlockModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockModelError';
  }
}

let fallbackId = 0;

/** Creates an opaque runtime identity without writing it into portable Markdown. */
export function createBlockId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `b_${globalThis.crypto.randomUUID()}`;
  }

  fallbackId += 1;
  return `b_${Date.now().toString(36)}_${fallbackId.toString(36)}`;
}

/** Extracts Logseq-style `key:: value` properties from text. */
export function extractBlockProperties(content: string): Record<string, string> {
  const properties: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const match = line.trim().match(/^([^:\n]+?)::\s*(.*)$/u);
    const key = match?.[1]?.trim();
    if (key) {
      properties[key] = match?.[2] ?? '';
    }
  }

  return properties;
}

/** Extracts unique page-reference targets while preserving their written spelling. */
export function extractBlockReferences(content: string): string[] {
  return [...new Set(extractPageLinks(content).map((link) => link.target))];
}

/** Extracts and case-normalizes `#tag` and `#[[multi word tag]]` tags. */
export function extractBlockTags(content: string): string[] {
  const tags = new Set<string>();
  const tagPattern = /(^|[^\p{L}\p{N}_])#(?:\[\[([^\]]+)\]\]|([\p{L}\p{N}_/-]+))/gu;

  for (const match of content.matchAll(tagPattern)) {
    const value = (match[2] ?? match[3])?.trim();
    if (value) {
      tags.add(value.toLocaleLowerCase());
    }
  }

  return [...tags];
}

function metadataText(content: string, properties: Record<string, string>): string {
  return [content, ...Object.entries(properties).map(([key, value]) => `${key}:: ${value}`)].join(
    '\n'
  );
}

function withDerivedMetadata(
  block: Omit<Block, 'properties' | 'references' | 'tags'> & {
    properties?: Record<string, string>;
  }
): Block {
  const properties = { ...extractBlockProperties(block.content), ...block.properties };
  const searchableContent = metadataText(block.content, properties);
  return {
    ...block,
    properties,
    references: extractBlockReferences(searchableContent),
    tags: extractBlockTags(searchableContent),
  };
}

function explicitProperties(block: Block): Record<string, string> {
  const inlineProperties = extractBlockProperties(block.content);
  return Object.fromEntries(
    Object.entries(block.properties).filter(([key, value]) => inlineProperties[key] !== value)
  );
}

function indentationWidth(value: string, tabSize: number): number {
  let width = 0;
  for (const character of value) {
    width += character === '\t' ? tabSize : 1;
  }
  return width;
}

interface MarkdownParseState {
  blocks: Block[];
  positions: Map<string | null, number>;
  stack: Array<{ id: string; indentation: number }>;
  currentBlock?: Block;
  currentIndentation: number;
  idFactory: () => string;
  tabSize: number;
}

function appendParsedBlock(
  state: MarkdownParseState,
  content: string,
  indentation: number,
  parentId: string | null
): void {
  const position = state.positions.get(parentId) ?? 0;
  state.positions.set(parentId, position + 1);
  const id = state.idFactory();
  if (!id) {
    throw new BlockModelError('The block ID factory returned an empty ID.');
  }

  const block = withDerivedMetadata({
    id,
    parentId,
    position,
    content,
    collapsed: false,
  });
  state.blocks.push(block);
  state.currentBlock = block;
  state.currentIndentation = indentation;
  state.stack.push({ id, indentation });
}

function parseBulletLine(state: MarkdownParseState, rawLine: string): boolean {
  const bullet = rawLine.match(/^([ \t]*)[-*+]\s+(.*)$/u);
  if (!bullet) {
    return false;
  }

  const indentation = indentationWidth(bullet[1] ?? '', state.tabSize);
  while (state.stack.length > 0 && (state.stack.at(-1)?.indentation ?? -1) >= indentation) {
    state.stack.pop();
  }
  appendParsedBlock(state, bullet[2] ?? '', indentation, state.stack.at(-1)?.id ?? null);
  return true;
}

function parseNonBulletLine(state: MarkdownParseState, rawLine: string): void {
  if (!rawLine.trim()) {
    return;
  }

  const leadingWhitespace = rawLine.match(/^[ \t]*/u)?.[0] ?? '';
  const indentation = indentationWidth(leadingWhitespace, state.tabSize);
  const property = rawLine.trim().match(/^([^:\n]+?)::\s*(.*)$/u);
  if (state.currentBlock && indentation > state.currentIndentation && property?.[1]?.trim()) {
    state.currentBlock.properties[property[1].trim()] = property[2] ?? '';
    Object.assign(state.currentBlock, withDerivedMetadata(state.currentBlock));
    return;
  }

  if (state.currentBlock && indentation > state.currentIndentation) {
    state.currentBlock.content += `\n${rawLine.trim()}`;
    Object.assign(state.currentBlock, withDerivedMetadata(state.currentBlock));
    return;
  }

  state.stack.length = 0;
  appendParsedBlock(state, rawLine.trim(), indentation, null);
}

/**
 * Parses portable bullet Markdown into a stable flat runtime model.
 *
 * IDs remain stable for subsequent structured operations. Callers that reconcile
 * external files can inject an ID factory backed by their own identity mapping.
 */
export function parseBlockMarkdown(
  markdown: string,
  options: ParseBlockMarkdownOptions = {}
): Block[] {
  const state: MarkdownParseState = {
    blocks: [],
    positions: new Map<string | null, number>(),
    stack: [],
    currentIndentation: -1,
    idFactory: options.idFactory ?? createBlockId,
    tabSize: options.tabSize ?? 2,
  };

  for (const rawLine of markdown.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')) {
    if (parseBulletLine(state, rawLine)) {
      continue;
    }
    parseNonBulletLine(state, rawLine);
  }

  validateBlocks(state.blocks);
  return state.blocks;
}

function cloneBlock(block: Block): Block {
  return {
    ...block,
    properties: { ...block.properties },
    references: [...block.references],
    tags: [...block.tags],
  };
}

function compareBlocks(left: Block, right: Block): number {
  return left.position - right.position;
}

function validateBlockAncestry(block: Block, byId: ReadonlyMap<string, Block>): void {
  const ancestors = new Set<string>([block.id]);
  let parentId = block.parentId;
  while (parentId !== null) {
    if (ancestors.has(parentId)) {
      throw new BlockModelError(`Block "${block.id}" has cyclic ancestry.`);
    }
    ancestors.add(parentId);
    parentId = byId.get(parentId)?.parentId ?? null;
  }
}

/** Throws when IDs, parents, positions, or ancestry do not form a valid block model. */
export function validateBlocks(blocks: readonly Block[]): void {
  const byId = new Map(blocks.map((block) => [block.id, block]));
  if (byId.size !== blocks.length) {
    throw new BlockModelError('Block IDs must be unique.');
  }

  for (const block of blocks) {
    if (!block.id) {
      throw new BlockModelError('Block IDs cannot be empty.');
    }
    if (!Number.isFinite(block.position) || block.position < 0) {
      throw new BlockModelError(`Block "${block.id}" has an invalid position.`);
    }
    if (block.parentId !== null && !byId.has(block.parentId)) {
      throw new BlockModelError(`Block "${block.id}" has a missing parent.`);
    }
    validateBlockAncestry(block, byId);
  }
}

/** Converts the flat persisted/indexable representation into an ordered render tree. */
export function blocksToTree(blocks: readonly Block[]): BlockNode[] {
  validateBlocks(blocks);
  const nodes = new Map<string, BlockNode>();
  const roots: BlockNode[] = [];

  for (const block of blocks) {
    nodes.set(block.id, { ...cloneBlock(block), children: [] });
  }

  for (const block of blocks) {
    const node = nodes.get(block.id);
    if (!node) {
      continue;
    }
    if (block.parentId === null) {
      roots.push(node);
    } else {
      nodes.get(block.parentId)?.children.push(node);
    }
  }

  const sortChildren = (siblings: BlockNode[]): void => {
    siblings.sort(compareBlocks);
    for (const sibling of siblings) {
      sortChildren(sibling.children);
    }
  };
  sortChildren(roots);
  return roots;
}

/** Flattens a render tree to canonical pre-order and recalculates sibling positions. */
export function flattenBlockTree(tree: readonly BlockNode[]): Block[] {
  const blocks: Block[] = [];
  const visit = (nodes: readonly BlockNode[], parentId: string | null): void => {
    nodes.forEach((node, position) => {
      const { children, ...block } = node;
      blocks.push(cloneBlock({ ...block, parentId, position }));
      visit(children, node.id);
    });
  };
  visit(tree, null);
  validateBlocks(blocks);
  return blocks;
}

/** Returns canonical pre-order with contiguous positions at every hierarchy level. */
export function normalizeBlockOrder(blocks: readonly Block[]): Block[] {
  return flattenBlockTree(blocksToTree(blocks));
}

/** Serializes the runtime model to portable, human-readable bullet Markdown. */
export function serializeBlockMarkdown(
  blocks: readonly Block[],
  options: SerializeBlockMarkdownOptions = {}
): string {
  if (blocks.length === 0) {
    return '';
  }

  const indentSize = options.indentSize ?? 2;
  const lines: string[] = [];
  const visit = (nodes: readonly BlockNode[], depth: number): void => {
    const blockIndent = ' '.repeat(depth * indentSize);
    const continuationIndent = ' '.repeat((depth + 1) * indentSize);
    for (const node of nodes) {
      const contentLines = node.content.split('\n');
      lines.push(`${blockIndent}- ${contentLines[0] ?? ''}`);
      for (const line of contentLines.slice(1)) {
        lines.push(`${continuationIndent}${line}`);
      }

      const inlineProperties = extractBlockProperties(node.content);
      for (const [key, value] of Object.entries(node.properties)) {
        if (inlineProperties[key] !== value) {
          lines.push(`${continuationIndent}${key}:: ${value}`);
        }
      }
      visit(node.children, depth + 1);
    }
  };
  visit(blocksToTree(blocks), 0);

  const markdown = lines.join('\n');
  return options.finalNewline === false ? markdown : `${markdown}\n`;
}

function getBlock(blocks: readonly Block[], blockId: string): Block {
  const block = blocks.find((candidate) => candidate.id === blockId);
  if (!block) {
    throw new BlockModelError(`Unknown block "${blockId}".`);
  }
  return block;
}

function siblingsOf(blocks: readonly Block[], parentId: string | null): Block[] {
  return blocks.filter((block) => block.parentId === parentId).sort(compareBlocks);
}

/** Creates a block at an explicit parent/index location. */
export function createBlock(
  blocks: readonly Block[],
  options: CreateBlockOptions = {}
): BlockEditResult {
  const parentId = options.parentId ?? null;
  if (parentId !== null) {
    getBlock(blocks, parentId);
  }

  const id = options.id ?? createBlockId();
  if (!id || blocks.some((block) => block.id === id)) {
    throw new BlockModelError(`Block ID "${id}" is empty or already exists.`);
  }

  const siblings = siblingsOf(blocks, parentId);
  const index = Math.max(0, Math.min(options.position ?? siblings.length, siblings.length));
  const shifted = blocks.map((block) =>
    block.parentId === parentId && block.position >= index
      ? { ...cloneBlock(block), position: block.position + 1 }
      : cloneBlock(block)
  );
  const block = withDerivedMetadata({
    id,
    parentId,
    position: index,
    content: options.content ?? '',
    collapsed: false,
  });
  return {
    blocks: normalizeBlockOrder([...shifted, block]),
    focusId: id,
    caretOffset: block.content.length,
  };
}

/** Creates a new sibling immediately below the current block. */
export function createSiblingBlock(
  blocks: readonly Block[],
  blockId: string,
  content = '',
  id = createBlockId()
): BlockEditResult {
  const block = getBlock(blocks, blockId);
  return createBlock(blocks, {
    id,
    parentId: block.parentId,
    position: block.position + 1,
    content,
  });
}

/** Splits content at a caret offset and creates a following sibling. */
export function splitBlock(
  blocks: readonly Block[],
  blockId: string,
  caretOffset: number,
  id = createBlockId()
): BlockEditResult {
  const block = getBlock(blocks, blockId);
  if (!Number.isInteger(caretOffset) || caretOffset < 0 || caretOffset > block.content.length) {
    throw new BlockModelError(`Caret offset ${caretOffset} is outside block "${blockId}".`);
  }

  const before = block.content.slice(0, caretOffset);
  const after = block.content.slice(caretOffset);
  const updated = blocks.map((candidate) =>
    candidate.id === blockId
      ? withDerivedMetadata({
          ...cloneBlock(candidate),
          content: before,
          properties: explicitProperties(candidate),
        })
      : cloneBlock(candidate)
  );
  return createSiblingBlock(updated, blockId, after, id);
}

/** Updates text and refreshes derived properties, references, and tags. */
export function updateBlockContent(
  blocks: readonly Block[],
  blockId: string,
  content: string
): Block[] {
  getBlock(blocks, blockId);
  return blocks.map((block) =>
    block.id === blockId
      ? withDerivedMetadata({
          ...cloneBlock(block),
          content,
          properties: explicitProperties(block),
        })
      : cloneBlock(block)
  );
}

/** Indents a block beneath its previous sibling, carrying its complete subtree. */
export function indentBlock(blocks: readonly Block[], blockId: string): Block[] {
  const block = getBlock(blocks, blockId);
  const siblings = siblingsOf(blocks, block.parentId);
  const index = siblings.findIndex((sibling) => sibling.id === blockId);
  const previousSibling = siblings[index - 1];
  if (!previousSibling) {
    return normalizeBlockOrder(blocks);
  }

  const position = siblingsOf(blocks, previousSibling.id).length;
  return normalizeBlockOrder(
    blocks.map((candidate) =>
      candidate.id === blockId
        ? { ...cloneBlock(candidate), parentId: previousSibling.id, position }
        : cloneBlock(candidate)
    )
  );
}

/** Outdents a block to immediately after its parent, carrying its complete subtree. */
export function outdentBlock(blocks: readonly Block[], blockId: string): Block[] {
  const block = getBlock(blocks, blockId);
  if (block.parentId === null) {
    return normalizeBlockOrder(blocks);
  }

  const parent = getBlock(blocks, block.parentId);
  return normalizeBlockOrder(
    blocks.map((candidate) =>
      candidate.id === blockId
        ? {
            ...cloneBlock(candidate),
            parentId: parent.parentId,
            position: parent.position + 0.5,
          }
        : cloneBlock(candidate)
    )
  );
}

function descendantIds(blocks: readonly Block[], blockId: string): Set<string> {
  const descendants = new Set<string>();
  const pending = [blockId];
  while (pending.length > 0) {
    const parentId = pending.pop();
    for (const block of blocks) {
      if (block.parentId === parentId) {
        descendants.add(block.id);
        pending.push(block.id);
      }
    }
  }
  return descendants;
}

/** Moves a block and its implicit subtree to a new parent/index. */
export function moveBlock(
  blocks: readonly Block[],
  blockId: string,
  target: MoveBlockTarget
): Block[] {
  const block = getBlock(blocks, blockId);
  if (target.parentId !== null) {
    getBlock(blocks, target.parentId);
  }
  if (target.parentId === blockId || descendantIds(blocks, blockId).has(target.parentId ?? '')) {
    throw new BlockModelError('A block cannot be moved beneath itself or one of its descendants.');
  }

  const targetSiblings = siblingsOf(blocks, target.parentId).filter(
    (sibling) => sibling.id !== blockId
  );
  const index = Math.max(0, Math.min(target.index, targetSiblings.length));
  targetSiblings.splice(index, 0, block);
  const targetPositions = new Map(
    targetSiblings.map((sibling, position) => [sibling.id, position])
  );

  return normalizeBlockOrder(
    blocks.map((candidate) => {
      if (candidate.id === blockId) {
        return { ...cloneBlock(candidate), parentId: target.parentId, position: index };
      }
      const position = targetPositions.get(candidate.id);
      return position === undefined
        ? cloneBlock(candidate)
        : { ...cloneBlock(candidate), position };
    })
  );
}

/** Moves a block immediately before another block. */
export function moveBlockBefore(
  blocks: readonly Block[],
  blockId: string,
  targetBlockId: string
): Block[] {
  if (blockId === targetBlockId) {
    return normalizeBlockOrder(blocks);
  }
  const target = getBlock(blocks, targetBlockId);
  const siblings = siblingsOf(blocks, target.parentId).filter((block) => block.id !== blockId);
  return moveBlock(blocks, blockId, {
    parentId: target.parentId,
    index: siblings.findIndex((block) => block.id === targetBlockId),
  });
}

/** Moves a block immediately after another block. */
export function moveBlockAfter(
  blocks: readonly Block[],
  blockId: string,
  targetBlockId: string
): Block[] {
  if (blockId === targetBlockId) {
    return normalizeBlockOrder(blocks);
  }
  const target = getBlock(blocks, targetBlockId);
  const siblings = siblingsOf(blocks, target.parentId).filter((block) => block.id !== blockId);
  return moveBlock(blocks, blockId, {
    parentId: target.parentId,
    index: siblings.findIndex((block) => block.id === targetBlockId) + 1,
  });
}

function appendContent(left: string, right: string): string {
  if (!left) {
    return right;
  }
  return `${left}${right}`;
}

/**
 * Merges a block into its previous sibling (or parent for a first child).
 * Direct children are reparented to the merge target, never discarded.
 */
export function mergeBlockWithPrevious(blocks: readonly Block[], blockId: string): BlockEditResult {
  const block = getBlock(blocks, blockId);
  const siblings = siblingsOf(blocks, block.parentId);
  const siblingIndex = siblings.findIndex((sibling) => sibling.id === blockId);
  const target =
    siblings[siblingIndex - 1] ??
    (block.parentId === null ? undefined : getBlock(blocks, block.parentId));
  if (!target) {
    return { blocks: normalizeBlockOrder(blocks), focusId: blockId, caretOffset: 0 };
  }

  const caretOffset = target.content.length;
  const properties = { ...target.properties };
  const conflictingProperties: string[] = [];
  for (const [key, value] of Object.entries(block.properties)) {
    if (properties[key] !== undefined && properties[key] !== value) {
      conflictingProperties.push(`${key}:: ${value}`);
    } else {
      properties[key] = value;
    }
  }
  const mergedContent = [appendContent(target.content, block.content), ...conflictingProperties]
    .filter(Boolean)
    .join('\n');
  const existingChildren = siblingsOf(blocks, target.id);
  const movedChildren = siblingsOf(blocks, block.id);
  const movedPositions = new Map(
    movedChildren.map((child, index) => [child.id, existingChildren.length + index])
  );

  const updated = blocks
    .filter((candidate) => candidate.id !== blockId)
    .map((candidate) => {
      if (candidate.id === target.id) {
        return withDerivedMetadata({
          ...cloneBlock(candidate),
          content: mergedContent,
          properties,
        });
      }
      const position = movedPositions.get(candidate.id);
      if (candidate.parentId === blockId && position !== undefined) {
        return { ...cloneBlock(candidate), parentId: target.id, position };
      }
      return cloneBlock(candidate);
    });

  return {
    blocks: normalizeBlockOrder(updated),
    focusId: target.id,
    caretOffset,
  };
}

/**
 * Removes only an empty block. Its children are promoted into the same location,
 * preventing an implicit subtree deletion.
 */
export function deleteEmptyBlock(blocks: readonly Block[], blockId: string): BlockEditResult {
  const block = getBlock(blocks, blockId);
  if (block.content.length > 0 || Object.keys(block.properties).length > 0) {
    throw new BlockModelError(`Block "${blockId}" is not empty.`);
  }

  const siblings = siblingsOf(blocks, block.parentId);
  const previous = siblings[siblings.findIndex((sibling) => sibling.id === blockId) - 1];
  const children = siblingsOf(blocks, blockId);
  const childPositions = new Map(
    children.map((child, index) => [child.id, block.position + index])
  );
  const shift = Math.max(0, children.length - 1);
  const updated = blocks
    .filter((candidate) => candidate.id !== blockId)
    .map((candidate) => {
      const childPosition = childPositions.get(candidate.id);
      if (candidate.parentId === blockId && childPosition !== undefined) {
        return {
          ...cloneBlock(candidate),
          parentId: block.parentId,
          position: childPosition,
        };
      }
      if (candidate.parentId === block.parentId && candidate.position > block.position) {
        return { ...cloneBlock(candidate), position: candidate.position + shift };
      }
      return cloneBlock(candidate);
    });
  const normalized = normalizeBlockOrder(updated);
  const focus = previous ?? children[0] ?? siblings.find((sibling) => sibling.id !== blockId);
  const normalizedFocus = focus && normalized.find((candidate) => candidate.id === focus.id);
  return {
    blocks: normalized,
    focusId: normalizedFocus?.id ?? null,
    caretOffset: normalizedFocus?.content.length ?? 0,
  };
}

/** Updates presentation-only collapse state without changing hierarchy or content. */
export function setBlockCollapsed(
  blocks: readonly Block[],
  blockId: string,
  collapsed: boolean
): Block[] {
  getBlock(blocks, blockId);
  return blocks.map((block) =>
    block.id === blockId ? { ...cloneBlock(block), collapsed } : cloneBlock(block)
  );
}

export function toggleBlockCollapsed(blocks: readonly Block[], blockId: string): Block[] {
  const block = getBlock(blocks, blockId);
  return setBlockCollapsed(blocks, blockId, !block.collapsed);
}
