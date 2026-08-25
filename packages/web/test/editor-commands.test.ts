import { describe, expect, it } from 'vitest';
import { applyDateReference, applyEditorCommand } from '../src/client/editor-commands.js';

const edit = (
  command: Parameters<typeof applyEditorCommand>[0],
  content: string,
  start: number,
  end = start
) => applyEditorCommand(command, content, { start, end });

describe('editor commands', () => {
  it('inserts a valid date as a Logseq page reference', () => {
    expect(applyDateReference('Review ', { start: 7, end: 7 }, '2026-08-25')).toMatchObject({
      content: 'Review [[2026-08-25]]',
      selectionStart: 21,
      selectionEnd: 21,
    });
    expect(applyDateReference('old text', { start: 0, end: 8 }, '2024-02-29').content).toBe(
      '[[2024-02-29]]'
    );
  });

  it('leaves the edit untouched for malformed or impossible dates', () => {
    expect(applyDateReference('text', { start: 2, end: 2 }, '2026-02-30')).toMatchObject({
      content: 'text',
      selectionStart: 2,
      selectionEnd: 2,
    });
    expect(applyDateReference('text', { start: 0, end: 1 }, 'tomorrow').content).toBe('text');
  });

  it('wraps selected and empty ranges with Logseq syntax', () => {
    expect(edit('page-link', 'Read Projects', 5, 13)).toMatchObject({
      content: 'Read [[Projects]]',
      selection: { start: 7, end: 15 },
    });
    expect(edit('block-reference', '', 0)).toMatchObject({
      content: '(())',
      selectionStart: 2,
      selectionEnd: 2,
    });
    expect(edit('bold', 'word', 0, 4).content).toBe('**word**');
    expect(edit('italic', '', 0).content).toBe('__');
    expect(edit('inline-code', 'x', 1, 1).content).toBe('x``');
    expect(edit('tag', 'topic', 0, 5)).toMatchObject({
      content: '#topic',
      selection: { start: 1, end: 6 },
    });
  });

  it('inserts a property suffix and places the caret after it', () => {
    expect(edit('property', 'owner', 0, 5)).toMatchObject({
      content: 'owner:: ',
      selectionStart: 8,
      selectionEnd: 8,
    });
    expect(edit('property', '', 0).content).toBe(':: ');
  });

  it('cycles task markers while preserving the body', () => {
    expect(edit('cycle-task', 'Write docs', 4)).toMatchObject({
      content: 'TODO Write docs',
      selectionStart: 9,
    });
    expect(edit('cycle-task', '', 0)).toMatchObject({
      content: 'TODO',
      selectionStart: 4,
      selectionEnd: 4,
    });
    expect(edit('cycle-task', 'Write docs', 0, 5)).toMatchObject({
      content: 'TODO Write docs',
      selection: { start: 5, end: 10 },
    });
    expect(edit('cycle-task', 'TODO Write docs', 5)).toMatchObject({
      content: 'DOING Write docs',
      selectionStart: 6,
    });
    expect(edit('cycle-task', 'DOING Write docs', 6).content).toBe('DONE Write docs');
    expect(edit('cycle-task', 'DONE Write docs', 10).content).toBe('Write docs');
    expect(edit('cycle-task', 'TODO   Keep spacing', 4).content).toBe('DOING   Keep spacing');
  });
});
