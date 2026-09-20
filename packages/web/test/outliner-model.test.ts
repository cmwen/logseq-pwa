import { buildWorkspaceIndex } from '@loam/core';
import { describe, expect, it } from 'vitest';
import {
  assessOutlinerSafety,
  deleteBlock,
  dropBlock,
  extendKeyboardBlockSelection,
  focusBlockTree,
  indentBlock,
  indentBlocks,
  mergeBlockBackward,
  moveBlock,
  outdentBlock,
  outdentBlocks,
  parseMarkdownBlocks,
  pasteMarkdownBlocks,
  selectVisibleBlockRange,
  serializeMarkdownBlocks,
  splitBlock,
  toggleBlockCollapsed,
  visibleBlockIds,
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

  it('indents and outdents multiple selected blocks as one operation', () => {
    const blocks = parseMarkdownBlocks('- One\n- Two\n  - Existing child\n- Three\n- Four');
    const twoId = blocks[1].id;
    const threeId = blocks[2].id;
    const indented = indentBlocks(blocks, [twoId, threeId]);
    expect(serializeMarkdownBlocks(indented.blocks)).toBe(
      '- One\n  - Two\n    - Existing child\n  - Three\n- Four'
    );

    const restored = outdentBlocks(indented.blocks, [twoId, threeId]);
    expect(serializeMarkdownBlocks(restored.blocks)).toBe(
      '- One\n- Two\n  - Existing child\n- Three\n- Four'
    );
  });

  it('selects visible blocks with a stable anchor and contracts when reversed', () => {
    const blocks = parseMarkdownBlocks('- One\n- Parent\n  - Hidden child\n- Three\n- Four');
    const ids = [blocks[0].id, blocks[1].id, blocks[1].children[0].id, blocks[2].id, blocks[3].id];
    expect(visibleBlockIds(blocks)).toEqual(ids);
    expect(selectVisibleBlockRange(blocks, ids[1], ids[3])).toEqual(ids.slice(1, 4));

    const down = extendKeyboardBlockSelection(blocks, undefined, ids[1], 1);
    expect(down).toEqual({ ids: ids.slice(1, 3), anchorId: ids[1], focusId: ids[2] });
    const fartherDown = extendKeyboardBlockSelection(
      blocks,
      down?.anchorId,
      down?.focusId ?? ids[2],
      1
    );
    expect(fartherDown?.ids).toEqual(ids.slice(1, 4));
    const up = extendKeyboardBlockSelection(
      blocks,
      fartherDown?.anchorId,
      fartherDown?.focusId ?? ids[3],
      -1
    );
    expect(up?.ids).toEqual(ids.slice(1, 3));
  });

  it('does not navigate into collapsed descendants or past visible boundaries', () => {
    const blocks = parseMarkdownBlocks('- One\n- Parent\n  - Hidden child\n- Three');
    const collapsed = toggleBlockCollapsed(blocks, blocks[1].id).blocks;
    const ids = visibleBlockIds(collapsed);
    expect(ids).toEqual([blocks[0].id, blocks[1].id, blocks[2].id]);
    expect(extendKeyboardBlockSelection(collapsed, undefined, ids[0], -1)).toBeUndefined();
    expect(
      extendKeyboardBlockSelection(collapsed, undefined, ids[ids.length - 1], 1)
    ).toBeUndefined();
  });

  it('does not move a selected descendant twice when its parent is selected', () => {
    const blocks = parseMarkdownBlocks('- One\n- Two\n  - Child\n- Three');
    const moved = indentBlocks(blocks, [blocks[1].id, blocks[1].children[0].id]);
    expect(serializeMarkdownBlocks(moved.blocks)).toBe('- One\n  - Two\n    - Child\n- Three');
  });

  it('toggles collapse without changing serialized Markdown', () => {
    const blocks = parseMarkdownBlocks('- Parent\n  - Child');
    const collapsed = toggleBlockCollapsed(blocks, blocks[0].id);
    expect(collapsed.blocks[0]?.collapsed).toBe(true);
    expect(serializeMarkdownBlocks(collapsed.blocks)).toBe('- Parent\n  - Child');
    const expanded = toggleBlockCollapsed(collapsed.blocks, blocks[0].id);
    expect(expanded.blocks[0]?.collapsed).toBe(false);
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

  it('preserves collapse state when a block is focused', () => {
    const blocks = parseMarkdownBlocks('- One\n  - Child');
    const collapsed = toggleBlockCollapsed(blocks, blocks[0].id);
    const focused = focusBlockTree(collapsed.blocks, blocks[0].id);
    expect(focused[0]?.collapsed).toBe(true);
    expect(focused[0]?.children).toHaveLength(1);
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

  it('groups rich-text paste under its first block', () => {
    const blocks = parseMarkdownBlocks('- Before  after\n- Existing');
    const pasted = pasteMarkdownBlocks(
      blocks,
      blocks[0].id,
      { start: 7, end: 7 },
      'A summary paragraph\n\n### Video highlights\n\n- First highlight\n  - Nested detail\n- Second highlight',
      { groupRichText: true }
    );

    expect(serializeMarkdownBlocks(pasted.blocks)).toBe(
      [
        '- Before A summary paragraph after',
        '  - ### Video highlights',
        '  - First highlight',
        '    - Nested detail',
        '  - Second highlight',
        '- Existing',
      ].join('\n')
    );
    expect(pasted.focusId).toBe(blocks[0]?.id);
    expect(pasted.caret).toBe('Before A summary paragraph'.length);
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
