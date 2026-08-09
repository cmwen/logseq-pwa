import { describe, expect, it } from 'vitest';
import { analyzePages, migratePages } from '../src/migration.js';

describe('lossless migration analysis', () => {
  it('normalizes metadata while preserving source content and reports findings', () => {
    const source = [
      '# Daily note',
      '- Task',
      '  status:: open',
      '  status:: closed',
      '  attachment: ![image](../assets/photo.png)',
      '  malformed [[Page',
      '| Name | Value |',
      '| --- | --- |',
    ].join('\n');
    const result = analyzePages([
      { title: 'Project___Now', path: 'pages/one.md', content: source },
      { title: 'project/now.md', path: 'pages/two.md', content: '- Other' },
    ]);

    expect(result.pages[0]?.normalizedTitle).toBe('project/now');
    expect(result.pages[0]?.content).toBe(source);
    expect(result.normalizedPages).toBe(result.pages);
    expect(result.report.convertedFiles.map((file) => file.path)).toEqual([
      'pages/one.md',
      'pages/two.md',
    ]);
    expect(result.report.unsupportedConstructs.map(({ kind }) => kind)).toEqual([
      'heading',
      'table',
      'table',
    ]);
    expect(result.report.malformedPageReferences[0]?.reason).toContain('not closed');
    expect(result.report.malformedPageRefs).toBe(result.report.malformedPageReferences);
    expect(result.report.duplicatePageNames[0]?.normalizedTitle).toBe('project/now');
    expect(result.report.duplicateNames).toBe(result.report.duplicatePageNames);
    expect(result.report.conflictingDuplicateBlockProperties).toEqual([
      {
        path: 'pages/one.md',
        title: 'Project___Now',
        blockPath: [0],
        key: 'status',
        values: ['open', 'closed'],
      },
    ]);
    expect(result.report.attachmentReferences.map(({ target }) => target)).toEqual([
      '../assets/photo.png',
    ]);
    expect(result.report.attachments).toBe(result.report.attachmentReferences);
  });

  it('exposes migration as an equivalent pure operation', () => {
    const pages = [{ title: '', path: 'pages/Inbox.md', content: '- Keep me' }];
    expect(migratePages(pages)).toEqual(analyzePages(pages));
    expect(migratePages(pages).pages[0]?.normalizedTitle).toBe('inbox');
  });
});
