import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceIndex,
  deterministicBlockId,
  findBlock,
  findContextualBacklinks,
  findDuplicatePages,
  searchWorkspaceBlocks,
} from '../src/workspace.js';

describe('workspace index', () => {
  const pages = [
    {
      title: 'Home',
      path: 'pages/Home.md',
      content: '- Parent\n  - Child [[Projects]]\n    id:: child-id\n- Other',
    },
    {
      title: 'Projects',
      path: 'pages/Projects.md',
      content: '- Project notes',
    },
  ];

  it('creates deterministic structural IDs and honors explicit id properties', () => {
    const first = buildWorkspaceIndex(pages);
    const second = buildWorkspaceIndex(pages);
    const firstIds = first.blocks.map((block) => block.id);
    const secondIds = second.blocks.map((block) => block.id);

    expect(firstIds).toEqual(secondIds);
    expect(first.pages[0]?.blocks[1]?.id).toBe('child-id');
    expect(first.pages[0]?.blocks[0]?.id).toBe(
      deterministicBlockId('home\u0000pages/home.md', [0])
    );
  });

  it('searches blocks with root-to-parent ancestor context', () => {
    const index = buildWorkspaceIndex(pages);
    const results = searchWorkspaceBlocks(index, 'projects');

    expect(results).toHaveLength(1);
    expect(results[0]?.block.content).toContain('Projects');
    expect(results[0]?.ancestors.map((block) => block.content)).toEqual(['Parent']);
    expect(results[0]?.page.title).toBe('Home');
  });

  it('supports exact lookup and contextual backlinks', () => {
    const index = buildWorkspaceIndex(pages);
    const child = findBlock(index, 'child-id');
    const backlinks = findContextualBacklinks(index, 'projects');

    expect(child?.ancestors.map((block) => block.id)).toEqual([index.pages[0]?.blocks[0]?.id]);
    expect(
      backlinks.map(({ block, ancestors, target }) => ({
        content: block.content,
        ancestors: ancestors.map((ancestor) => ancestor.content),
        target,
      }))
    ).toEqual([{ content: 'Child [[Projects]]', ancestors: ['Parent'], target: 'Projects' }]);
  });

  it('detects duplicate normalized page names deterministically', () => {
    expect(
      findDuplicatePages([
        { title: 'Project___Now', path: 'pages/a.md', content: '' },
        { title: 'project/now.md', path: 'pages/b.md', content: '' },
        { title: 'Other', path: 'pages/other.md', content: '' },
      ])
    ).toEqual([
      {
        normalizedTitle: 'project/now',
        pages: [
          { title: 'Project___Now', path: 'pages/a.md', content: '' },
          { title: 'project/now.md', path: 'pages/b.md', content: '' },
        ],
      },
    ]);
  });
});
