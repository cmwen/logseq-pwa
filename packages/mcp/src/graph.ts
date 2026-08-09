import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import {
  buildPageIndex,
  type IndexedPage,
  normalizePageTitle,
  type PageInput,
  pageFilenameForTitle,
  pageTitleFromPath,
  serializeCaptureBlockMarkdown,
} from '@loam/core';

export class GraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphError';
  }
}

export interface GraphPage extends IndexedPage {}

export interface GraphStoreOptions {
  graphRoot: string;
  now?: () => Date;
}

export interface PageReference {
  title?: string;
  path?: string;
  page?: string;
}

function journalTitleFromPath(relativePath: string): string | undefined {
  const match = relativePath.match(/^journals\/(\d{4})[_-](\d{2})[_-](\d{2})\.md$/iu);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

export function titleFromGraphPath(relativePath: string): string {
  return journalTitleFromPath(relativePath) ?? pageTitleFromPath(relativePath);
}

function normalizeGraphPath(value: string): string {
  const candidate = value.trim().replaceAll('\\', '/');
  if (!candidate || candidate.includes('\u0000')) {
    throw new GraphError('A page path must not be empty or contain NUL characters.');
  }
  if (candidate.startsWith('/') || /^[A-Za-z]:\//u.test(candidate)) {
    throw new GraphError('Page paths must be relative to the graph root.');
  }

  const segments = candidate.split('/');
  if (segments.some((segment) => segment === '..')) {
    throw new GraphError('Page paths may not contain parent-directory traversal.');
  }

  const normalized = path.posix.normalize(candidate).replace(/^\.\//u, '');
  if (normalized === '.' || normalized.startsWith('../') || normalized === '..') {
    throw new GraphError('Page path escapes the graph root.');
  }
  if (!normalized.toLocaleLowerCase().endsWith('.md')) {
    throw new GraphError('Page paths must point to a Markdown file.');
  }
  return normalized;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function formatFsError(error: unknown, operation: string, relativePath?: string): GraphError {
  if (error instanceof GraphError) return error;
  const suffix = relativePath ? ` "${relativePath}"` : '';
  if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
    return new GraphError(`Could not ${operation}${suffix}: file or directory not found.`);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new GraphError(`Could not ${operation}${suffix}: ${message}`);
}

async function collectMarkdownPaths(
  directory: string,
  relativeDirectory: string,
  paths: string[]
): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    throw formatFsError(error, 'read the graph directory', relativeDirectory || undefined);
  }

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectMarkdownPaths(absolutePath, relativePath, paths);
    } else if (entry.isFile() && entry.name.toLocaleLowerCase().endsWith('.md')) {
      paths.push(relativePath.replaceAll(path.sep, '/'));
    }
  }
}

export class GraphStore {
  readonly root: string;
  private readonly now: () => Date;

  constructor(options: GraphStoreOptions) {
    if (!options.graphRoot?.trim()) {
      throw new GraphError('LOAM_GRAPH_ROOT must point to a graph directory.');
    }
    this.root = path.resolve(options.graphRoot);
    this.now = options.now ?? (() => new Date());
  }

  async listMarkdownPaths(): Promise<string[]> {
    try {
      const rootStat = await fs.stat(this.root);
      if (!rootStat.isDirectory())
        throw new GraphError(`Graph root is not a directory: ${this.root}`);
    } catch (error) {
      throw formatFsError(error, 'open the graph root');
    }

    const paths: string[] = [];
    await collectMarkdownPaths(this.root, '', paths);
    return paths.sort((left, right) => left.localeCompare(right));
  }

  async readPageContent(relativePath: string): Promise<string> {
    const normalizedPath = normalizeGraphPath(relativePath);
    const absolutePath = path.resolve(this.root, normalizedPath);
    if (!isWithin(this.root, absolutePath)) {
      throw new GraphError('Page path escapes the graph root.');
    }
    try {
      const realRoot = await fs.realpath(this.root);
      const realPath = await fs.realpath(absolutePath);
      if (!isWithin(realRoot, realPath)) {
        throw new GraphError('Page path resolves outside the graph root.');
      }
      return await fs.readFile(realPath, 'utf8');
    } catch (error) {
      throw formatFsError(error, 'read page', normalizedPath);
    }
  }

  async readPages(): Promise<GraphPage[]> {
    const paths = await this.listMarkdownPaths();
    const inputs: PageInput[] = [];
    for (const relativePath of paths) {
      inputs.push({
        title: titleFromGraphPath(relativePath),
        path: relativePath,
        content: await this.readPageContent(relativePath),
      });
    }
    return buildPageIndex(inputs).sort((left, right) => left.title.localeCompare(right.title));
  }

  async findPage(reference: PageReference): Promise<GraphPage> {
    const pages = await this.readPages();
    const title = reference.title?.trim() || reference.page?.trim();
    const relativePath = reference.path ? normalizeGraphPath(reference.path) : undefined;
    if (!title && !relativePath) {
      throw new GraphError('Provide a page title or a relative Markdown path.');
    }

    const matches = pages.filter((page) => {
      const titleMatches = title && normalizePageTitle(page.title) === normalizePageTitle(title);
      const pathMatches =
        relativePath && page.path.toLocaleLowerCase() === relativePath.toLocaleLowerCase();
      return Boolean(titleMatches || pathMatches);
    });
    if (matches.length === 0) {
      const requested = relativePath ?? title;
      throw new GraphError(`Page not found: "${requested}".`);
    }
    if (matches.length > 1) {
      throw new GraphError(`Page reference is ambiguous: "${title ?? relativePath}".`);
    }
    return matches[0];
  }

  async writePage(
    relativePath: string,
    content: string,
    expectedContent?: string
  ): Promise<GraphPage> {
    const normalizedPath = normalizeGraphPath(relativePath);
    const absolutePath = path.resolve(this.root, normalizedPath);
    if (!isWithin(this.root, absolutePath))
      throw new GraphError('Page path escapes the graph root.');
    try {
      const handle = await fs.open(absolutePath, constants.O_RDWR | constants.O_NOFOLLOW);
      try {
        const current = await handle.readFile('utf8');
        if (expectedContent !== undefined && current !== expectedContent) {
          throw new GraphError(
            `Write conflict for "${normalizedPath}": the page changed since expectedContent was read.`
          );
        }
        await handle.truncate(0);
        await handle.writeFile(content, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      throw formatFsError(error, 'write page', normalizedPath);
    }
    return this.findPage({ path: normalizedPath });
  }

  async createPage(title: string, content?: string): Promise<GraphPage> {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) throw new GraphError('Page title must not be empty.');
    if (trimmedTitle.includes('\u0000'))
      throw new GraphError('Page title must not contain NUL characters.');
    const filename = pageFilenameForTitle(trimmedTitle);
    const relativePath = `pages/${filename}`;
    const pages = await this.readPages();
    if (pages.some((page) => normalizePageTitle(page.title) === normalizePageTitle(trimmedTitle))) {
      throw new GraphError(`A page named "${trimmedTitle}" already exists.`);
    }

    const absolutePath = path.resolve(this.root, relativePath);
    if (!isWithin(this.root, absolutePath))
      throw new GraphError('Page path escapes the graph root.');
    try {
      await this.assertSafeWriteParent(relativePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content ?? '- ', {
        encoding: 'utf8',
        flag: 'wx',
      });
    } catch (error) {
      throw formatFsError(error, 'create page', relativePath);
    }
    return this.findPage({ path: relativePath });
  }

  async captureToday(content: string, dateText?: string): Promise<GraphPage> {
    const block = serializeCaptureBlockMarkdown(content);
    const date = dateText ? this.parseDate(dateText) : this.now();
    const dateParts = {
      year: String(date.getFullYear()).padStart(4, '0'),
      month: String(date.getMonth() + 1).padStart(2, '0'),
      day: String(date.getDate()).padStart(2, '0'),
    };
    const relativePath = `journals/${dateParts.year}_${dateParts.month}_${dateParts.day}.md`;
    const absolutePath = path.resolve(this.root, relativePath);
    if (!isWithin(this.root, absolutePath))
      throw new GraphError('Journal path escapes the graph root.');
    try {
      await this.assertSafeWriteParent(relativePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      const handle = await fs.open(
        absolutePath,
        constants.O_APPEND | constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
        0o600
      );
      try {
        const details = await handle.stat();
        const tail = Buffer.alloc(1);
        if (details.size > 0) await handle.read(tail, 0, 1, details.size - 1);
        const separator = details.size === 0 || tail[0] === 10 ? '' : '\n';
        await handle.writeFile(`${separator}${block}`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      throw formatFsError(error, 'capture to journal', relativePath);
    }
    return this.findPage({ path: relativePath });
  }

  private parseDate(value: string): Date {
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/u);
    if (!match) throw new GraphError('date must use YYYY-MM-DD format.');
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (
      date.getFullYear() !== Number(match[1]) ||
      date.getMonth() !== Number(match[2]) - 1 ||
      date.getDate() !== Number(match[3])
    ) {
      throw new GraphError(`Invalid date: "${value}".`);
    }
    return date;
  }

  private async assertSafeWriteParent(relativePath: string): Promise<void> {
    const absolutePath = path.resolve(this.root, relativePath);
    const realRoot = await fs.realpath(this.root);
    let parent = path.dirname(absolutePath);
    while (parent !== this.root && !isWithin(this.root, parent)) {
      parent = path.dirname(parent);
    }
    while (true) {
      try {
        const realParent = await fs.realpath(parent);
        if (!isWithin(realRoot, realParent)) {
          throw new GraphError('Write path resolves outside the graph root.');
        }
        return;
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
          throw error;
        }
        const next = path.dirname(parent);
        if (next === parent) throw error;
        parent = next;
      }
    }
  }
}

export function graphRootFromEnvironment(environment: NodeJS.ProcessEnv = process.env): string {
  const graphRoot = environment.LOAM_GRAPH_ROOT?.trim();
  if (!graphRoot) throw new GraphError('Set LOAM_GRAPH_ROOT to the root of a Logseq graph.');
  return graphRoot;
}
