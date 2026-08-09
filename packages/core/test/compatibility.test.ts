import { describe, expect, it } from 'vitest';
import { analyzeMarkdownCompatibility, isMarkdownRoundTripSafe } from '../src/compatibility.js';

describe('Markdown compatibility', () => {
  it('accepts portable nested bullets and properties', () => {
    const markdown = '- Parent\n  status:: open\n  - Child\n';
    const report = analyzeMarkdownCompatibility(markdown);

    expect(report.safe).toBe(true);
    expect(report.roundTrippable).toBe(true);
    expect(report.issues).toEqual([]);
    expect(isMarkdownRoundTripSafe(markdown)).toBe(true);
  });

  it('flags headings, ordered lists, fenced code, and tables', () => {
    const report = analyzeMarkdownCompatibility(
      [
        '# Heading',
        '1. Ordered item',
        '```ts',
        'const value = 1;',
        '```',
        '| Name | Value |',
        '| --- | --- |',
        '| one | two |',
      ].join('\n')
    );

    expect(report.safe).toBe(false);
    expect(report.issues.map((issue) => issue.kind)).toEqual([
      'heading',
      'ordered-list',
      'fenced-code',
      'fenced-code',
      'fenced-code',
      'table',
      'table',
      'table',
    ]);
  });

  it('normalizes a missing final newline without changing source', () => {
    const source = '- A';
    const report = analyzeMarkdownCompatibility(source);

    expect(report.roundTrippable).toBe(true);
    expect(report.serialized).toBe('- A\n');
    expect(source).toBe('- A');
  });

  it('flags a plain paragraph as raw Markdown that would become a bullet', () => {
    const report = analyzeMarkdownCompatibility('A paragraph\n');

    expect(report.safe).toBe(false);
    expect(report.issues[0]?.kind).toBe('raw-markdown');
  });
});
