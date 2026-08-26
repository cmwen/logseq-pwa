import { describe, expect, it } from 'vitest';
import {
  buildPageHierarchy,
  buildTagSummaries,
  extractDatePrimitives,
  extractHashtagReferenceDetails,
  extractHashtags,
  journalDateFromPath,
  pageBreadcrumbs,
  parseDatePrimitive,
  parseJournalPageDate,
} from '../src/client/graph-model.js';

describe('graph model', () => {
  it('extracts tags while ignoring markdown headings and frontmatter', () => {
    const markdown =
      '---\ntags: ignored\n---\n## Heading @Roadmap\nBody @Project @[[Multi word]] #project `@inline` person@example.com https://example.com/@url\n```\n@code\n```';
    expect(extractHashtags(markdown)).toEqual(['roadmap', 'project', 'multi word']);
    expect(extractHashtagReferenceDetails(markdown).map((reference) => reference.raw)).toEqual([
      '@Roadmap',
      '@Project',
      '@[[Multi word]]',
      '#project',
    ]);
  });

  it('summarizes occurrences and distinct page membership', () => {
    const pages = [
      { title: 'Alpha', path: 'pages/alpha.md', content: '@one @one @Two' },
      { title: 'Beta', path: 'pages/beta.md', content: '#two @three' },
    ];
    expect(buildTagSummaries(pages)).toEqual([
      { count: 2, pageCount: 1, pagePaths: ['pages/alpha.md'], pages: ['Alpha'], tag: 'one' },
      { count: 1, pageCount: 1, pagePaths: ['pages/beta.md'], pages: ['Beta'], tag: 'three' },
      {
        count: 2,
        pageCount: 2,
        pagePaths: ['pages/alpha.md', 'pages/beta.md'],
        pages: ['Alpha', 'Beta'],
        tag: 'two',
      },
    ]);
  });

  it('creates namespace breadcrumbs and synthetic parents', () => {
    const hierarchy = buildPageHierarchy([
      { title: 'Project/Now', path: 'pages/Project___Now.md', content: '' },
      { title: 'Project/Next', path: 'pages/Project___Next.md', content: '' },
    ]);
    expect(hierarchy.roots.map((node) => node.title)).toEqual(['Project']);
    expect(hierarchy.roots[0]?.children.map((node) => node.title)).toEqual([
      'Project/Next',
      'Project/Now',
    ]);
    expect(hierarchy.nodes.find((node) => node.title === 'Project/Now')?.breadcrumbs).toEqual([
      'Project',
      'Now',
    ]);
    expect(pageBreadcrumbs('Project/Now')).toEqual(['Project', 'Now']);
  });

  it('parses ISO, long, linked, and journal dates without rolling invalid dates', () => {
    expect(parseDatePrimitive('[[2026-08-09]]')?.toISOString()).toBe('2026-08-09T00:00:00.000Z');
    expect(parseDatePrimitive('Mon, 09th Aug 2026')?.toISOString()).toBe(
      '2026-08-09T00:00:00.000Z'
    );
    expect(parseDatePrimitive('2026-02-30')).toBeNull();
    expect(extractDatePrimitives('Due [[2026-08-09]]; review 2026-09-10')).toMatchObject([
      { iso: '2026-08-09', source: 'link' },
      { iso: '2026-09-10', source: 'token' },
    ]);
    expect(journalDateFromPath('journals/2026_08_09.md')?.toISOString()).toBe(
      '2026-08-09T00:00:00.000Z'
    );
    expect(
      parseJournalPageDate({ path: 'journals/2026_08_09.md', title: '2026-08-09' })?.toISOString()
    ).toBe('2026-08-09T00:00:00.000Z');
  });
});
