import { describe, expect, it } from 'vitest';
import {
  buildPageIndex,
  extractPageLinks,
  normalizePageTitle,
  pageTitleFromPath,
} from '../src/logseq.js';

describe('Logseq helpers', () => {
  it('normalizes page names from links and filenames', () => {
    expect(normalizePageTitle('Project___Now.md')).toBe('project now');
    expect(pageTitleFromPath('pages/Weekly%20Review.md')).toBe('Weekly Review');
  });

  it('extracts page links and aliases', () => {
    expect(extractPageLinks('See [[Home]] and [[Weekly Review|this review]].')).toEqual([
      { target: 'Home', label: 'Home' },
      { target: 'Weekly Review', label: 'this review' },
    ]);
  });

  it('builds backlinks from outgoing page references', () => {
    const pages = buildPageIndex([
      { title: 'Home', path: 'pages/Home.md', content: 'Read [[Projects]].' },
      { title: 'Projects', path: 'pages/Projects.md', content: 'Link back to [[Home]].' },
      { title: 'Notes', path: 'pages/Notes.md', content: 'Also see [[Projects]].' },
    ]);

    expect(pages.find((page) => page.title === 'Projects')?.backlinks).toEqual(['Home', 'Notes']);
    expect(pages.find((page) => page.title === 'Home')?.links).toEqual([
      { target: 'Projects', label: 'Projects' },
    ]);
  });
});
