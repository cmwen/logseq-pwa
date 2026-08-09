import { describe, expect, it } from 'vitest';
import {
  BlockModelError,
  blocksToTree,
  createSiblingBlock,
  deleteEmptyBlock,
  indentBlock,
  mergeBlockWithPrevious,
  moveBlock,
  outdentBlock,
  parseBlockMarkdown,
  serializeBlockMarkdown,
  splitBlock,
  toggleBlockCollapsed,
  updateBlockContent,
} from '../src/blocks.js';

function ids(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `extra-${index}`;
}

describe('block Markdown', () => {
  it('parses nested Logseq bullets into ordered stable blocks and metadata', () => {
    const blocks = parseBlockMarkdown(
      [
        '- Parent [[Project/Now/Recall]] #Research',
        '  owner:: [[Chris]]',
        '  - Child',
        '    - Grandchild #[[Deep Work]]',
        '- Second root',
      ].join('\n'),
      { idFactory: ids('parent', 'child', 'grandchild', 'second') }
    );

    expect(blocks.map(({ id, parentId, position }) => ({ id, parentId, position }))).toEqual([
      { id: 'parent', parentId: null, position: 0 },
      { id: 'child', parentId: 'parent', position: 0 },
      { id: 'grandchild', parentId: 'child', position: 0 },
      { id: 'second', parentId: null, position: 1 },
    ]);
    expect(blocks[0]?.properties).toEqual({ owner: '[[Chris]]' });
    expect(blocks[0]?.references).toEqual(['Project/Now/Recall', 'Chris']);
    expect(blocks[0]?.tags).toEqual(['research']);
    expect(blocks[2]?.tags).toEqual(['deep work']);
    expect(blocksToTree(blocks)[0]?.children[0]?.children[0]?.id).toBe('grandchild');
  });

  it('round-trips portable Markdown without serializing runtime state', () => {
    const markdown = [
      '- Morning run',
      '  exercise-type:: Running',
      '  duration:: 35',
      '  - Felt good',
      '- Review architecture',
      '',
    ].join('\n');
    const blocks = parseBlockMarkdown(markdown, {
      idFactory: ids('run', 'feeling', 'review'),
    });
    const collapsed = toggleBlockCollapsed(blocks, 'run');

    expect(serializeBlockMarkdown(collapsed)).toBe(markdown);
    const reparsed = parseBlockMarkdown(serializeBlockMarkdown(collapsed), {
      idFactory: ids('new-run', 'new-feeling', 'new-review'),
    });
    expect(reparsed.map((block) => block.content)).toEqual(blocks.map((block) => block.content));
    expect(reparsed[0]?.properties).toEqual(blocks[0]?.properties);
  });

  it('preserves unsupported non-bullet text as root content instead of discarding it', () => {
    const blocks = parseBlockMarkdown('# Heading\n- A block', {
      idFactory: ids('heading', 'block'),
    });
    expect(blocks.map((block) => block.content)).toEqual(['# Heading', 'A block']);
  });
});

describe('structured block operations', () => {
  it('creates and splits siblings while retaining the original subtree', () => {
    const initial = parseBlockMarkdown('- Parent thought\n  - Child', {
      idFactory: ids('parent', 'child'),
    });
    const split = splitBlock(initial, 'parent', 6, 'remainder');
    const created = createSiblingBlock(split.blocks, 'remainder', 'Third', 'third');

    expect(created.blocks.map((block) => [block.id, block.parentId, block.content])).toEqual([
      ['parent', null, 'Parent'],
      ['child', 'parent', 'Child'],
      ['remainder', null, ' thought'],
      ['third', null, 'Third'],
    ]);
    expect(split.focusId).toBe('remainder');
    expect(split.caretOffset).toBe(8);
  });

  it('indents and outdents a complete subtree', () => {
    const initial = parseBlockMarkdown('- A\n- B\n  - B child\n- C', {
      idFactory: ids('a', 'b', 'b-child', 'c'),
    });
    const indented = indentBlock(initial, 'b');
    expect(indented.find((block) => block.id === 'b')?.parentId).toBe('a');
    expect(indented.find((block) => block.id === 'b-child')?.parentId).toBe('b');

    const restored = outdentBlock(indented, 'b');
    expect(restored.map((block) => [block.id, block.parentId, block.position])).toEqual([
      ['a', null, 0],
      ['b', null, 1],
      ['b-child', 'b', 0],
      ['c', null, 2],
    ]);
  });

  it('moves a subtree and rejects ancestry cycles', () => {
    const initial = parseBlockMarkdown('- A\n  - Child\n    - Grandchild\n- B', {
      idFactory: ids('a', 'child', 'grandchild', 'b'),
    });
    const moved = moveBlock(initial, 'child', { parentId: 'b', index: 0 });

    expect(moved.map((block) => [block.id, block.parentId])).toEqual([
      ['a', null],
      ['b', null],
      ['child', 'b'],
      ['grandchild', 'child'],
    ]);
    expect(() => moveBlock(initial, 'a', { parentId: 'grandchild', index: 0 })).toThrow(
      BlockModelError
    );
  });

  it('merges without losing children or conflicting properties', () => {
    const initial = parseBlockMarkdown(
      '- First\n  status:: open\n- second\n  status:: closed\n  - Child',
      { idFactory: ids('first', 'second', 'child') }
    );
    const merged = mergeBlockWithPrevious(initial, 'second');
    const target = merged.blocks.find((block) => block.id === 'first');

    expect(target?.content).toBe('Firstsecond\nstatus:: closed');
    expect(target?.properties).toEqual({ status: 'open' });
    expect(merged.blocks.find((block) => block.id === 'child')?.parentId).toBe('first');
    expect(merged.focusId).toBe('first');
    expect(merged.caretOffset).toBe(5);
  });

  it('deletes only empty blocks and promotes their children safely', () => {
    const initial = parseBlockMarkdown('- Before\n- \n  - Preserved\n- After', {
      idFactory: ids('before', 'empty', 'child', 'after'),
    });
    const result = deleteEmptyBlock(initial, 'empty');

    expect(result.blocks.map((block) => [block.id, block.parentId, block.position])).toEqual([
      ['before', null, 0],
      ['child', null, 1],
      ['after', null, 2],
    ]);
    expect(() => deleteEmptyBlock(initial, 'before')).toThrow('is not empty');
  });

  it('updates all derived metadata when block content changes', () => {
    const initial = parseBlockMarkdown('- Old #Tag [[Page]]', { idFactory: ids('block') });
    const updated = updateBlockContent(initial, 'block', 'New #Other [[Next]]\npriority:: high');
    const block = updated[0];

    expect(block?.properties).toEqual({ priority: 'high' });
    expect(block?.references).toEqual(['Next']);
    expect(block?.tags).toEqual(['other']);
  });
});
