import { describe, expect, it } from 'vitest';
import { parseMarkdownDocument } from '../src/client/markdown-model.js';

describe('Markdown document model', () => {
  it('parses all Markdown heading levels', () => {
    const nodes = parseMarkdownDocument(
      '# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six'
    );
    expect(nodes.filter((node) => node.type === 'heading').map((node) => node.level)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });

  it('parses aligned tables and keeps inline Markdown in cells', () => {
    const [node] = parseMarkdownDocument(
      '| Name | Count | Notes |\n| :--- | ---: | :---: |\n| **Alpha** | 3 | [[Details]] |\n| Beta | 4 | Ready |'
    );
    expect(node).toEqual({
      table: {
        alignments: ['left', 'right', 'center'],
        headers: ['Name', 'Count', 'Notes'],
        rows: [
          ['**Alpha**', '3', '[[Details]]'],
          ['Beta', '4', 'Ready'],
        ],
      },
      type: 'table',
    });
  });

  it('parses fenced code, quotes, and ordered list items', () => {
    const nodes = parseMarkdownDocument(
      '> A note\n> with context\n\n1. First\n2. Second\n\n```ts\nconst answer = 42;\n```'
    );
    expect(nodes).toEqual([
      { lines: ['A note', 'with context'], type: 'blockquote' },
      { key: 'blank-1', type: 'blank' },
      { indentation: 0, marker: '1.', text: 'First', type: 'ordered' },
      { indentation: 0, marker: '2.', text: 'Second', type: 'ordered' },
      { key: 'blank-4', type: 'blank' },
      { language: 'ts', type: 'code', value: 'const answer = 42;' },
    ]);
  });
});
