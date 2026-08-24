import { parseFrontmatter } from '@loam/core';
import { describe, expect, it, vi } from 'vitest';
import {
  createPageFile,
  findJournalByDate,
  journalPathForDate,
  journalTitleForDate,
  localPageTitleFromPath,
} from '../src/client/logseq.js';

describe('journal helpers', () => {
  const date = new Date(2026, 7, 9, 23, 45);

  it('uses the local calendar date for journal paths and labels', () => {
    expect(journalPathForDate(date)).toBe('journals/2026_08_09.md');
    expect(journalTitleForDate(date)).toBe('2026-08-09');
  });

  it('finds a journal without relying on its display title', () => {
    const journal = {
      title: 'Aug 9th, 2026',
      path: 'journals/2026_08_09.md',
      content: '- Today',
      links: [],
      backlinks: [],
    };

    expect(findJournalByDate([journal], date)).toBe(journal);
  });

  it('gives journal files a date-reference-friendly page title', () => {
    expect(localPageTitleFromPath('journals/2026_08_09.md')).toBe('2026-08-09');
    expect(localPageTitleFromPath('pages/Project___Now.md')).toBe('Project/Now');
  });

  it('creates pages with portable YAML frontmatter and a safe bullet body', async () => {
    let written = '';
    const writable = {
      close: vi.fn(async () => undefined),
      write: vi.fn(async (content: string) => {
        written = content;
      }),
    };
    const file = {
      createWritable: async () => writable,
      kind: 'file',
      name: 'Project.md',
    } as unknown as FileSystemFileHandle;
    let lookup = 0;
    const pages = {
      getFileHandle: async (_name: string, options?: { create?: boolean }) => {
        lookup += 1;
        if (!options?.create) throw new DOMException('Missing', 'NotFoundError');
        return file;
      },
      kind: 'directory',
      name: 'pages',
    } as unknown as FileSystemDirectoryHandle;
    const root = {
      getDirectoryHandle: async () => pages,
      kind: 'directory',
      name: 'graph',
    } as unknown as FileSystemDirectoryHandle;

    await createPageFile(root, 'Project');

    const document = parseFrontmatter(written);
    expect(lookup).toBe(2);
    expect(document.data['loam-id']).toEqual(expect.any(String));
    expect(document.data['loam-schema']).toBe(1);
    expect(document.data.created).toEqual(expect.any(String));
    expect(document.body).toBe('- ');
  });
});
