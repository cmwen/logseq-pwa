import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GraphStore, normalizeGraphRelativePath, parseDate } from '../src/graph.js';
import { createWebApp } from '../src/modes/web.js';

const temporaryGraphs: string[] = [];

async function graphFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'loam-cli-'));
  temporaryGraphs.push(root);
  await mkdir(join(root, 'pages'), { recursive: true });
  await mkdir(join(root, 'journals'), { recursive: true });
  await writeFile(
    join(root, 'pages', 'Home.md'),
    '- Read [[Project/Now]]\n  - Keep the useful context\n',
    'utf8'
  );
  await writeFile(join(root, 'pages', 'Project___Now.md'), '- Ship the CLI\n', 'utf8');
  await writeFile(join(root, 'journals', '2026_08_09.md'), '- Existing note\n', 'utf8');
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryGraphs.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe('GraphStore', () => {
  it('indexes pages, resolves normalized titles, and preserves hierarchy context in search', async () => {
    const root = await graphFixture();
    const store = new GraphStore(root);

    await expect(store.info()).resolves.toMatchObject({
      pageCount: 3,
      journalCount: 1,
      attachmentCount: 0,
    });
    await expect(store.findPage('project/now')).resolves.toMatchObject({
      title: 'Project/Now',
      path: 'pages/Project___Now.md',
    });

    await expect(store.searchBlocks('useful')).resolves.toEqual([
      expect.objectContaining({
        pageTitle: 'Home',
        content: 'Keep the useful context',
        ancestors: ['Read [[Project/Now]]'],
        context: 'Read [[Project/Now]]',
      }),
    ]);
    await expect(store.backlinks('Project/Now')).resolves.toEqual([
      expect.objectContaining({
        pageTitle: 'Home',
        pagePath: 'pages/Home.md',
        blocks: [expect.objectContaining({ content: 'Read [[Project/Now]]' })],
      }),
    ]);
  });

  it('captures dated journals and creates namespace-safe pages without traversal', async () => {
    const root = await graphFixture();
    const store = new GraphStore(root);

    const captured = await store.capture('Remember this\n- nested detail', parseDate('2026-08-10'));
    expect(captured.path).toBe('journals/2026_08_10.md');
    await expect(readFile(join(root, 'journals/2026_08_10.md'), 'utf8')).resolves.toBe(
      '- Remember this\n  - nested detail\n'
    );

    const created = await store.createPage('Projects/Ideas', '- First idea\n');
    expect(created.path).toBe('pages/Projects___Ideas.md');
    await expect(readFile(join(root, created.path), 'utf8')).resolves.toBe('- First idea\n');
    await expect(store.createPage('Projects/Ideas')).rejects.toThrow('already exists');
    await expect(store.createPage('../outside')).rejects.toThrow('unsafe path');
    expect(() => normalizeGraphRelativePath('../outside.md')).toThrow('Unsafe graph-relative path');

    const blank = await store.createPage('Projects/Blank');
    await expect(readFile(join(root, blank.path), 'utf8')).resolves.toBe('- ');

    const outsideRoot = await mkdtemp(join(tmpdir(), 'loam-cli-outside-'));
    temporaryGraphs.push(outsideRoot);
    const outsideFile = join(outsideRoot, 'journal.md');
    await writeFile(outsideFile, 'outside\n', 'utf8');
    await symlink(outsideFile, join(root, 'journals', '2026_08_11.md'));
    await expect(store.capture('Must stay inside', parseDate('2026-08-11'))).rejects.toThrow();
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside\n');
  });

  it('produces a read-only migration report for graph concerns', async () => {
    const root = await graphFixture();
    await writeFile(join(root, 'pages', 'foo.md'), '- One\n', 'utf8');
    await writeFile(
      join(root, 'pages', 'FOO.md'),
      [
        '- Parent [[Broken]\n',
        '  status:: open\n',
        '  status:: open\n',
        '  owner:: alice\n',
        '  owner:: bob\n',
        '  {{query (task TODO)}}\n',
        '  ![diagram](assets/diagram.png)\n',
      ].join(''),
      'utf8'
    );

    const report = await new GraphStore(root).validate();
    expect(report.readOnly).toBe(true);
    expect(report.summary.errors).toBeGreaterThan(0);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'duplicate-page',
        'malformed-reference',
        'duplicate-property',
        'conflicting-property',
        'unsupported-syntax',
        'attachment-reference',
      ])
    );
    await expect(readFile(join(root, 'pages', 'FOO.md'), 'utf8')).resolves.toContain('Parent');
  });
});

describe('web app factory', () => {
  it('creates an Express app without opening a listener and serves a configured graph API', async () => {
    const root = await graphFixture();
    const app = createWebApp({ graphPath: root });
    expect(typeof app).toBe('function');
    expect(app).toHaveProperty('get');
  });
});
