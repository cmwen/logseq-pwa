import { describe, expect, it } from 'vitest';
import {
  deleteBlock,
  indentBlock,
  mergeBlockBackward,
  moveBlock,
  outdentBlock,
  parseMarkdownBlocks,
  serializeMarkdownBlocks,
  splitBlock,
} from '../src/client/outliner-model.js';

describe('outliner model', () => {
  it('round trips nested Markdown blocks', () => {
    const markdown = '- Parent\n  - Child\n    - Grandchild\n- Sibling';
    expect(serializeMarkdownBlocks(parseMarkdownBlocks(markdown))).toBe(markdown);
  });

  it('splits and merges blocks without losing nested content', () => {
    const blocks = parseMarkdownBlocks('- Useful context\n  - Evidence');
    const split = splitBlock(blocks, blocks[0].id, 'Useful', ' context');
    expect(split.blocks.map((block) => block.content)).toEqual(['Useful', ' context']);
    expect(split.blocks[0].children[0].content).toBe('Evidence');

    const merged = mergeBlockBackward(split.blocks, split.blocks[1].id);
    expect(merged.blocks).toHaveLength(1);
    expect(merged.blocks[0].content).toBe('Useful context');
    expect(merged.blocks[0].children[0].content).toBe('Evidence');
  });

  it('indents, outdents, and moves complete subtrees', () => {
    const blocks = parseMarkdownBlocks('- One\n- Two\n  - Child\n- Three');
    const twoId = blocks[1].id;
    const indented = indentBlock(blocks, twoId);
    expect(serializeMarkdownBlocks(indented.blocks)).toBe('- One\n  - Two\n    - Child\n- Three');

    const outdented = outdentBlock(indented.blocks, twoId);
    const moved = moveBlock(outdented.blocks, twoId, 1);
    expect(serializeMarkdownBlocks(moved.blocks)).toBe('- One\n- Three\n- Two\n  - Child');
  });

  it('promotes children when an empty parent is removed', () => {
    const blocks = parseMarkdownBlocks('- \n  - Child\n- Last');
    const removed = deleteBlock(blocks, blocks[0].id, true);
    expect(serializeMarkdownBlocks(removed.blocks)).toBe('- Child\n- Last');
  });
});
