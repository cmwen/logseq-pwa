import { describe, expect, it } from 'vitest';
import { parseBlockMarkdown } from '../src/blocks.js';
import { analyzeMarkdownCompatibility } from '../src/compatibility.js';
import {
  composeMarkdown,
  FrontmatterParseError,
  parseFrontmatter,
  serializeFrontmatter,
  splitFrontmatter,
} from '../src/frontmatter.js';

describe('Markdown frontmatter', () => {
  it('splits and parses common YAML metadata without changing body source', () => {
    const source = [
      '---',
      'title: Home',
      'draft: false',
      'tags:',
      '  - project',
      '  - notes',
      'aliases: [Start, "Welcome Home"]',
      '---',
      '- Read [[Projects]]',
    ].join('\n');
    const parsed = parseFrontmatter(source);

    expect(parsed.data).toEqual({
      title: 'Home',
      draft: false,
      tags: ['project', 'notes'],
      aliases: ['Start', 'Welcome Home'],
    });
    expect(parsed.body).toBe('- Read [[Projects]]');
    expect(parsed.source).toBe(`${source.slice(0, source.indexOf('\n- Read'))}\n`);
    expect(composeMarkdown(parsed)).toBe(source);
  });

  it('returns a no-frontmatter result for ordinary Markdown', () => {
    expect(splitFrontmatter('- A\n')).toEqual({
      hasFrontmatter: false,
      source: null,
      body: '- A\n',
      lineCount: 0,
    });
  });

  it('does not treat a frontmatter section as a block', () => {
    const blocks = parseBlockMarkdown('---\ntitle: Home\n---\n- A\n', {
      idFactory: (() => {
        let id = 0;
        return () => `block-${id++}`;
      })(),
    });
    expect(blocks.map((block) => block.content)).toEqual(['A']);
  });

  it('keeps valid frontmatter safe for structured editing', () => {
    const report = analyzeMarkdownCompatibility('---\ntitle: Home\n---\n- A\n');
    expect(report.safe).toBe(true);
    expect(report.roundTrippable).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('reports malformed frontmatter instead of silently accepting it', () => {
    const report = analyzeMarkdownCompatibility('---\ntags:\n  - [broken\n---\n- A\n');
    expect(report.safe).toBe(false);
    expect(report.issues[0]?.kind).toBe('frontmatter');
    expect(report.issues[0]?.line).toBe(2);
  });

  it('serializes typed metadata when a new frontmatter section is needed', () => {
    expect(serializeFrontmatter({ title: 'Home', tags: ['notes'], published: true })).toBe(
      '---\ntitle: Home\ntags:\n  - notes\npublished: true\n---\n'
    );
  });

  it('throws a typed error for a frontmatter document that is not a mapping', () => {
    expect(() => parseFrontmatter('---\n- item\n---\n- body\n')).toThrow(FrontmatterParseError);
  });
});
