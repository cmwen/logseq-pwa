import { buildWorkspaceIndex } from '@loam/core';
import { describe, expect, it } from 'vitest';
import {
  assessOutlinerSafety,
  deleteBlock,
  dropBlock,
  focusBlockTree,
  indentBlock,
  mergeBlockBackward,
  moveBlock,
  outdentBlock,
  parseMarkdownBlocks,
  pasteMarkdownBlocks,
  serializeMarkdownBlocks,
  splitBlock,
} from '../src/client/outliner-model.js';

describe('outliner model', () => {
  it('keeps safe bullet pages in the structured editor and routes rich Markdown to raw mode', () => {
    expect(assessOutlinerSafety('- Parent\n  - Child')).toEqual({ safe: true, reasons: [] });
    expect(assessOutlinerSafety('# Heading\n\n- A').safe).toBe(false);
    expect(assessOutlinerSafety('1. Ordered\n\n> Quote').reasons).toEqual(
      expect.arrayContaining(['ordered lists', 'block quotes'])
    );
    expect(assessOutlinerSafety('```ts\nconst value = 1;\n```').reasons).toContain('fenced code');
    expect(assessOutlinerSafety('| A | B |\n| --- | --- |\n| 1 | 2 |').reasons).toContain('tables');
  });

  it('creates deterministic page-scoped IDs that survive reparsing', () => {
    const markdown = '- Same\n  - Child';
    const first = parseMarkdownBlocks(markdown, 'pages/one.md', 'one');
    const second = parseMarkdownBlocks(markdown, 'pages/one.md', 'one');
    expect(first[0]?.id).toBe(second[0]?.id);
    expect(first[0]?.children[0]?.id).toBe(second[0]?.children[0]?.id);
    expect(first[0]?.id).not.toBe(parseMarkdownBlocks('- Same', 'pages/two.md', 'two')[0]?.id);
    expect(first[0]?.id).toBe(
      buildWorkspaceIndex([{ title: 'one', path: 'pages/one.md', content: markdown }]).blocks[0]?.id
    );
  });
  it('round trips nested Markdown blocks', () => {
    const markdown = '- Parent\n  - Child\n    - Grandchild\n- Sibling';
    expect(serializeMarkdownBlocks(parseMarkdownBlocks(markdown))).toBe(markdown);
    expect(serializeMarkdownBlocks(parseMarkdownBlocks(`${markdown}\n`), true)).toBe(
      `${markdown}\n`
    );
  });

  it('keeps YAML frontmatter outside the structured block model', () => {
    const frontmatter = '---\nloam-id: page-1\ntags: [project]\n---\n';
    const markdown = `${frontmatter}- Parent\n  - Child\n`;
    const blocks = parseMarkdownBlocks(markdown, 'pages/one.md', 'one');

    expect(blocks[0]?.content).toBe('Parent');
    expect(serializeMarkdownBlocks(blocks, true, frontmatter)).toBe(markdown);
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

  it('drags complete subtrees and rejects descendant drops', () => {
    const blocks = parseMarkdownBlocks('- One\n  - Child\n- Two\n- Three');
    const moved = dropBlock(blocks, blocks[0].id, blocks[2].id, 'after');
    expect(serializeMarkdownBlocks(moved.blocks)).toBe('- Two\n- Three\n- One\n  - Child');
    const rejected = dropBlock(blocks, blocks[0].id, blocks[0].children[0].id, 'inside');
    expect(rejected.changed).toBe(false);
  });

  it('focuses a block while retaining every descendant', () => {
    const blocks = parseMarkdownBlocks('- One\n  - Child\n    - Grandchild\n- Two');
    const focused = focusBlockTree(blocks, blocks[0].id);
    expect(serializeMarkdownBlocks(focused)).toBe('- One\n  - Child\n    - Grandchild');
    expect(focused[0]?.collapsed).toBe(false);
  });

  it('pastes multiline Markdown as editable sibling and nested blocks', () => {
    const blocks = parseMarkdownBlocks('- Before  after\n- Existing');
    const pasted = pasteMarkdownBlocks(
      blocks,
      blocks[0].id,
      { start: 7, end: 7 },
      '## Plan\nIntro **bold**\n\n1. First\n  1. Nested\n2. Second'
    );

    expect(serializeMarkdownBlocks(pasted.blocks)).toBe(
      [
        '- Before ## Plan',
        '- Intro **bold**',
        '- 1. First',
        '  - 1. Nested',
        '- 2. Second after',
        '- Existing',
      ].join('\n')
    );
    expect(pasted.focusId).toBe(pasted.blocks[3]?.id);
    expect(pasted.caret).toBe('2. Second'.length);
  });

  it('replaces a selection with inline formatting without disturbing children', () => {
    const blocks = parseMarkdownBlocks('- Say old now\n  - Existing child');
    const pasted = pasteMarkdownBlocks(blocks, blocks[0].id, { start: 4, end: 7 }, '**new**');

    expect(serializeMarkdownBlocks(pasted.blocks)).toBe('- Say **new** now\n  - Existing child');
    expect(pasted.caret).toBe('Say **new**'.length);
  });

  it('keeps properties attached to the first pasted block', () => {
    const blocks = parseMarkdownBlocks('- ');
    const pasted = pasteMarkdownBlocks(
      blocks,
      blocks[0].id,
      { start: 0, end: 0 },
      '- Project\n  owner:: Chris'
    );

    expect(serializeMarkdownBlocks(pasted.blocks)).toBe('- Project\n  owner:: Chris');
  });
});
