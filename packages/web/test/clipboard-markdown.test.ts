import { describe, expect, it } from 'vitest';
import {
  markdownFromClipboard,
  normalizePastedMarkdown,
  richTextHtmlToMarkdown,
} from '../src/client/clipboard-markdown.js';

describe('clipboard Markdown', () => {
  it('preserves common rich-text structure as Markdown', () => {
    const html = [
      '<h2>Release plan</h2>',
      '<p>Keep <strong>bold</strong>, <em>emphasis</em>, <code>code</code>, and ',
      '<a href="https://example.com/a b">links</a>.</p>',
      '<ul><li>First<ul><li>Nested</li></ul></li><li>Second</li></ul>',
      '<ol start="3"><li>Third</li><li>Fourth</li></ol>',
    ].join('');

    expect(richTextHtmlToMarkdown(html)).toBe(
      [
        '## Release plan',
        '',
        'Keep **bold**, _emphasis_, `code`, and [links](https://example.com/a%20b).',
        '',
        '- First',
        '  - Nested',
        '- Second',
        '',
        '3. Third',
        '4. Fourth',
      ].join('\n')
    );
  });

  it('never carries executable clipboard markup into Markdown links', () => {
    expect(
      richTextHtmlToMarkdown(
        '<p>Safe <a href="javascript:alert(1)">label</a> &#999999999;</p><script>alert(2)</script>'
      )
    ).toBe('Safe label &#999999999;');
  });

  it('prefers HTML formatting and otherwise preserves plain Markdown', () => {
    expect(markdownFromClipboard({ html: '<p>A <b>bold</b> note</p>', text: 'A bold note' })).toBe(
      'A **bold** note'
    );
    expect(markdownFromClipboard({ text: '## Heading\r\n\r\n- Item' })).toBe(
      '## Heading\n\n- Item'
    );
  });

  it('normalizes ordered lists for the bullet outliner without losing numbering', () => {
    expect(normalizePastedMarkdown('1. First\n   1) Nested\n2. Last')).toBe(
      '- 1. First\n   - 1) Nested\n- 2. Last'
    );
  });
});
