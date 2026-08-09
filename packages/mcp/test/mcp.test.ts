import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMcpServer } from '../src/server.js';

const temporaryRoots: string[] = [];

async function createGraph(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'loam-mcp-'));
  temporaryRoots.push(root);
  await fs.mkdir(path.join(root, 'pages'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'pages', 'Home.md'),
    '- Welcome to the graph\n  - Find [[Projects]] here\n    - A nested context block\n',
    'utf8'
  );
  await fs.writeFile(
    path.join(root, 'pages', 'Projects.md'),
    '- Project index\n  - Ship the first release\n',
    'utf8'
  );
  return root;
}

async function call(root: string, name: string, args?: unknown): Promise<unknown> {
  const result = await createMcpServer({ graphRoot: root }).callTool(name, args);
  expect(result.content[0]?.type).toBe('text');
  return JSON.parse(result.content[0]?.text ?? '{}') as unknown;
}

async function callResult(root: string, name: string, args?: unknown) {
  return createMcpServer({ graphRoot: root }).callTool(name, args);
}

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe('graph reads', () => {
  it('lists pages and reads them by normalized title or path', async () => {
    const root = await createGraph();

    const listed = (await call(root, 'list_pages')) as {
      pages: Array<{ title: string; path: string }>;
      count: number;
    };
    expect(listed.count).toBe(2);
    expect(listed.pages.map((page) => page.title)).toEqual(['Home', 'Projects']);

    const byTitle = (await call(root, 'read_page', { title: ' hOmE ' })) as { content: string };
    const byPath = (await call(root, 'read_page', { path: 'pages/Home.md' })) as {
      content: string;
    };
    expect(byTitle.content).toContain('Welcome to the graph');
    expect(byPath.content).toBe(byTitle.content);
  });

  it('returns search matches with page and ancestor context', async () => {
    const root = await createGraph();
    const result = (await call(root, 'search_blocks', { query: 'nested context' })) as {
      matches: Array<{
        page: { title: string };
        block: { content: string };
        ancestors: Array<{ content: string }>;
      }>;
    };

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.page.title).toBe('Home');
    expect(result.matches[0]?.block.content).toBe('A nested context block');
    expect(result.matches[0]?.ancestors.map((ancestor) => ancestor.content)).toEqual([
      'Welcome to the graph',
      'Find [[Projects]] here',
    ]);
  });

  it('returns exact source block context for backlinks', async () => {
    const root = await createGraph();
    const result = (await call(root, 'get_backlinks', { page: 'projects' })) as {
      backlinks: Array<{
        sourcePage: { title: string };
        sourceBlock: { content: string };
        ancestors: Array<{ content: string }>;
      }>;
    };

    expect(result.backlinks).toHaveLength(1);
    expect(result.backlinks[0]?.sourcePage.title).toBe('Home');
    expect(result.backlinks[0]?.sourceBlock.content).toBe('Find [[Projects]] here');
    expect(result.backlinks[0]?.ancestors[0]?.content).toBe('Welcome to the graph');
  });
});

describe('graph writes', () => {
  it('creates pages, protects writes with expectedContent, and captures today', async () => {
    const root = await createGraph();
    const instance = createMcpServer({
      graphRoot: root,
      now: () => new Date(2026, 7, 9, 12, 0),
    });

    const created = await instance.callTool('create_page', {
      title: 'Meeting Notes',
      content: '- Original\n',
    });
    expect(created.isError).not.toBe(true);

    const conflict = await instance.callTool('write_page', {
      title: 'meeting notes',
      content: '- Changed\n',
      expectedContent: '- Stale\n',
    });
    expect(conflict.isError).toBe(true);
    expect(conflict.content[0]?.text).toContain('Write conflict');
    expect(await fs.readFile(path.join(root, 'pages', 'Meeting_Notes.md'), 'utf8')).toBe(
      '- Original\n'
    );

    const written = await instance.callTool('write_page', {
      path: 'pages/Meeting_Notes.md',
      content: '- Changed\n',
      expectedContent: '- Original\n',
    });
    expect(written.isError).not.toBe(true);

    const captured = await instance.callTool('capture_today', {
      content: 'Review the release plan\n- nested detail',
      date: '2026-08-09',
    });
    expect(captured.isError).not.toBe(true);
    expect(await fs.readFile(path.join(root, 'journals', '2026_08_09.md'), 'utf8')).toBe(
      '- Review the release plan\n  - nested detail\n'
    );

    const missingRevision = await instance.callTool('write_page', {
      path: 'pages/Meeting_Notes.md',
      content: '- Unsafe overwrite\n',
    });
    expect(missingRevision.isError).toBe(true);
  });
});

describe('graph validation and safety', () => {
  it('reports missing links without mutating the graph', async () => {
    const root = await createGraph();
    await fs.appendFile(
      path.join(root, 'pages', 'Home.md'),
      '- Missing [[Not Yet Created]]\n',
      'utf8'
    );
    const before = await fs.readFile(path.join(root, 'pages', 'Home.md'), 'utf8');

    const result = (await call(root, 'validate_graph')) as {
      valid: boolean;
      warnings: Array<{ message: string }>;
      migration: { required: boolean };
    };
    expect(result.valid).toBe(true);
    expect(result.warnings.some((warning) => warning.message.includes('Not Yet Created'))).toBe(
      true
    );
    expect(result.migration.required).toBe(false);
    expect(await fs.readFile(path.join(root, 'pages', 'Home.md'), 'utf8')).toBe(before);
  });

  it('includes the core migration report without changing source files', async () => {
    const root = await createGraph();
    const legacyPath = path.join(root, 'pages', 'Legacy.md');
    const legacyContent = '# Legacy heading\n\n- Keep this note\n';
    await fs.writeFile(legacyPath, legacyContent, 'utf8');

    const result = (await call(root, 'validate_graph')) as {
      migration: {
        required: boolean;
        report: { unsupportedConstructs: Array<{ kind: string }> };
      };
    };
    expect(result.migration.required).toBe(true);
    expect(result.migration.report.unsupportedConstructs[0]?.kind).toBe('heading');
    expect(await fs.readFile(legacyPath, 'utf8')).toBe(legacyContent);
  });

  it('rejects traversal paths and does not access outside the graph', async () => {
    const root = await createGraph();
    const result = await callResult(root, 'read_page', { path: '../outside.md' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('parent-directory traversal');
  });

  it('rejects capture through a symlinked journal file', async () => {
    const root = await createGraph();
    await fs.mkdir(path.join(root, 'journals'), { recursive: true });
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'loam-mcp-outside-'));
    temporaryRoots.push(outsideRoot);
    const outsideFile = path.join(outsideRoot, 'journal.md');
    await fs.writeFile(outsideFile, 'outside\n', 'utf8');
    await fs.symlink(outsideFile, path.join(root, 'journals', '2026_08_11.md'));

    const result = await callResult(root, 'capture_today', {
      content: 'Must stay inside',
      date: '2026-08-11',
    });
    expect(result.isError).toBe(true);
    expect(await fs.readFile(outsideFile, 'utf8')).toBe('outside\n');
  });

  it('requires a graph root from the environment when no factory root is supplied', () => {
    expect(() => createMcpServer({ environment: {} })).toThrow('LOAM_GRAPH_ROOT');
  });
});
