import { describe, expect, it, vi } from 'vitest';
import { type CachedPageState, reconcileLogseqFolder } from '../src/client/reconciliation.js';

function markdownFile(
  name: string,
  content: string,
  lastModified: number
): { handle: FileSystemFileHandle; text: ReturnType<typeof vi.fn> } {
  const text = vi.fn(async () => content);
  const file = {
    lastModified,
    name,
    size: new TextEncoder().encode(content).byteLength,
    text,
  } as unknown as File;
  const handle = {
    getFile: async () => file,
    kind: 'file',
    name,
  } as unknown as FileSystemFileHandle;
  return { handle, text };
}

function directory(name: string, entries: readonly FileSystemHandle[]): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    async *values() {
      for (const entry of entries) yield entry;
    },
  } as unknown as FileSystemDirectoryHandle;
}

describe('background graph reconciliation', () => {
  it('reuses unchanged content and reads only changed or new files', async () => {
    const unchanged = markdownFile('Alpha.md', '- stale disk text', 100);
    const changed = markdownFile('Beta.md', '- Links to [[Alpha]]', 201);
    const ignored = markdownFile('notes.txt', 'not markdown', 300);
    const root = directory('graph', [
      directory('pages', [unchanged.handle, changed.handle, ignored.handle]),
    ]);
    const cached: CachedPageState[] = [
      {
        blocks: [
          {
            blockId: 'cached-alpha',
            content: 'Cached Alpha',
            context: '',
            pagePath: 'pages/Alpha.md',
            pageTitle: 'Alpha',
            references: [],
          },
        ],
        content: '- Cached Alpha',
        frontmatter: { owner: 'cached' },
        frontmatterSource: '---\nowner: cached\n---\n',
        lastModified: 100,
        path: 'pages/Alpha.md',
        size: new TextEncoder().encode('- stale disk text').byteLength,
        title: 'Alpha',
      },
      {
        content: '- Old Beta',
        lastModified: 200,
        path: 'pages/Beta.md',
        size: 10,
        title: 'Beta',
      },
      {
        content: '- Removed',
        lastModified: 100,
        path: 'pages/Removed.md',
        size: 9,
        title: 'Removed',
      },
    ];

    const result = await reconcileLogseqFolder(root, cached);

    expect(unchanged.text).not.toHaveBeenCalled();
    expect(changed.text).toHaveBeenCalledOnce();
    expect(result.summary).toEqual({ changed: 1, deleted: 1, unchanged: 1 });
    expect(result.changedPaths).toEqual(['pages/Beta.md']);
    expect(result.deletedPaths).toEqual(['pages/Removed.md']);
    expect(result.pages.find((page) => page.title === 'Alpha')?.content).toBe('- Cached Alpha');
    expect(result.pages.find((page) => page.title === 'Alpha')?.frontmatter).toEqual({
      owner: 'cached',
    });
    expect(result.blockIndex.find((block) => block.pagePath === 'pages/Alpha.md')?.blockId).toBe(
      'cached-alpha'
    );
    expect(result.pages.find((page) => page.title === 'Alpha')?.backlinks).toEqual(['Beta']);
  });

  it('supports a forced integrity rebuild', async () => {
    const page = markdownFile('Alpha.md', '- Current', 100);
    const cached: CachedPageState[] = [
      {
        content: '- Cached',
        lastModified: 100,
        path: 'pages/Alpha.md',
        size: new TextEncoder().encode('- Current').byteLength,
        title: 'Alpha',
      },
    ];

    const result = await reconcileLogseqFolder(directory('graph', [page.handle]), cached, {
      force: true,
    });

    expect(page.text).toHaveBeenCalledOnce();
    expect(result.pages[0]?.content).toBe('- Current');
    expect(result.summary.changed).toBe(1);
  });

  it('parses YAML frontmatter for changed files without indexing it as a block', async () => {
    const content = '---\nowner: Chris\ntags:\n  - pwa\n---\n- Body links to [[Alpha]]\n';
    const page = markdownFile('Metadata.md', content, 100);

    const result = await reconcileLogseqFolder(directory('graph', [page.handle]), []);

    expect(result.pages[0]?.frontmatter).toEqual({ owner: 'Chris', tags: ['pwa'] });
    expect(result.pages[0]?.frontmatterSource).toBe('---\nowner: Chris\ntags:\n  - pwa\n---\n');
    expect(result.blockIndex).toHaveLength(1);
    expect(result.blockIndex[0]?.content).toBe('Body links to [[Alpha]]');
  });
});
