import { describe, expect, it } from 'vitest';
import {
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
});
