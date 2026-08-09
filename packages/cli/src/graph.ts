import { constants } from 'node:fs';
import { mkdir, open, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  analyzeMigration,
  buildPageIndex,
  buildWorkspaceIndex,
  findContextualBacklinks,
  type IndexedPage,
  normalizePageTitle,
  type PageInput,
  pageFilenameForTitle,
  pageTitleFromPath,
  searchWorkspaceBlocks,
  serializeCaptureBlockMarkdown,
} from '@loam/core';

const MARKDOWN_EXTENSION = '.md';
const JOURNAL_PATTERN = /^journals\/(\d{4})[_-](\d{2})[_-](\d{2})\.md$/iu;

export interface GraphPage extends IndexedPage {
  normalizedTitle: string;
  kind: 'page' | 'journal';
}

export interface GraphInfo {
  root: string;
  pageCount: number;
  journalCount: number;
  attachmentCount: number;
  markdownFiles: number;
}

export interface BlockSearchResult {
  blockId: string;
  content: string;
  pagePath: string;
  pageTitle: string;
  ancestors: string[];
  context: string;
  references: string[];
  tags: string[];
  properties: Record<string, string>;
}

export interface BacklinkResult {
  pagePath: string;
  pageTitle: string;
  blocks: Pick<BlockSearchResult, 'blockId' | 'content' | 'ancestors' | 'context'>[];
}

export type ValidationSeverity = 'error' | 'warning';
export type ValidationCode =
  | 'unsupported-syntax'
  | 'duplicate-page'
  | 'malformed-reference'
  | 'duplicate-property'
  | 'conflicting-property'
  | 'attachment-reference';

export interface ValidationDiagnostic {
  code: ValidationCode;
  severity: ValidationSeverity;
  message: string;
  pagePath?: string;
  line?: number;
  details?: string;
}

export interface ValidationReport {
  root: string;
  checkedPages: number;
  readOnly: true;
  diagnostics: ValidationDiagnostic[];
  summary: {
    errors: number;
    warnings: number;
  };
}

export function graphPathError(value: string): Error {
  return new Error(`Unsafe graph-relative path: ${value}`);
}

/** Normalizes a user-supplied path without allowing absolute or parent traversal. */
export function normalizeGraphRelativePath(value: string): string {
  const candidate = value.trim().replaceAll('\\', '/');
  if (
    !candidate ||
    candidate.startsWith('/') ||
    /^[A-Za-z]:\//u.test(candidate) ||
    candidate.split('/').some((part) => part === '..' || part === '')
  ) {
    throw graphPathError(value);
  }

  const normalized = candidate
    .split('/')
    .filter((part) => part !== '.')
    .join('/');
  if (!normalized || normalized.includes('\0')) {
    throw graphPathError(value);
  }
  return normalized;
}

function isInside(root: string, target: string): boolean {
  const child = relative(root, target);
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

async function ensureDirectory(path: string): Promise<string> {
  const resolved = resolve(path);
  const details = await stat(resolved).catch(() => undefined);
  if (!details?.isDirectory()) {
    throw new Error(`Graph path is not a directory: ${resolved}`);
  }
  return realpath(resolved);
}

interface FileEntry {
  relativePath: string;
  absolutePath: string;
}

async function walkGraph(
  root: string,
  current = root,
  entries: FileEntry[] = []
): Promise<FileEntry[]> {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const absolutePath = join(current, entry.name);
    if (entry.isDirectory()) {
      await walkGraph(root, absolutePath, entries);
      continue;
    }
    if (!entry.isFile()) continue;
    const resolved = await realpath(absolutePath);
    if (!isInside(root, resolved)) continue;
    entries.push({
      relativePath: relative(root, absolutePath).split(sep).join('/'),
      absolutePath,
    });
  }
  return entries;
}

function titleForPath(path: string): string {
  const journal = path.match(JOURNAL_PATTERN);
  return journal ? `${journal[1]}-${journal[2]}-${journal[3]}` : pageTitleFromPath(path);
}

function pageKind(path: string): 'page' | 'journal' {
  return path.toLocaleLowerCase().startsWith('journals/') ? 'journal' : 'page';
}

function toGraphPage(page: IndexedPage): GraphPage {
  return {
    ...page,
    normalizedTitle: normalizePageTitle(page.title),
    kind: pageKind(page.path),
  };
}

function blockResult(
  page: Pick<GraphPage, 'path' | 'title'>,
  block: ReturnType<typeof buildWorkspaceIndex>['blocks'][number],
  ancestorBlocks: ReturnType<typeof buildWorkspaceIndex>['blocks']
): BlockSearchResult {
  const ancestors = ancestorBlocks.map(
    (ancestor) => ancestor.content.split('\n')[0]?.trim() || 'Empty block'
  );
  return {
    blockId: block.id,
    content: block.content.split('\n')[0]?.trim() || 'Empty block',
    pagePath: page.path,
    pageTitle: page.title,
    ancestors,
    context: ancestors.join(' > '),
    references: block.references,
    tags: block.tags,
    properties: block.properties,
  };
}

function safePageReference(reference: string): string {
  const value = reference.trim();
  if (!value || value.includes('\0')) throw new Error('A page title or path is required.');
  return value;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Property diagnostics intentionally follows nested Markdown indentation.
function propertyDiagnostics(
  content: string,
  pagePath: string,
  diagnostics: ValidationDiagnostic[]
): void {
  const stack: {
    indentation: number;
    properties: Map<string, { value: string; line: number }>;
  }[] = [];
  const indentation = (value: string): number => value.replaceAll('\t', '  ').length;

  for (const [lineIndex, line] of content.split(/\r?\n/u).entries()) {
    const bullet = line.match(/^([ \t]*)[-*+]\s+(.*)$/u);
    if (bullet) {
      const width = indentation(bullet[1] ?? '');
      while (stack.at(-1) && (stack.at(-1)?.indentation ?? -1) >= width) stack.pop();
      stack.push({ indentation: width, properties: new Map() });
      continue;
    }

    const property = line.match(/^([ \t]+)([^:\n]+?)::\s*(.*)$/u);
    const current = stack.at(-1);
    if (!property || !current || indentation(property[1] ?? '') <= current.indentation) continue;
    const key = property[2]?.trim();
    if (!key) continue;
    const value = property[3] ?? '';
    const previous = current.properties.get(key);
    if (previous) {
      const conflicting = previous.value !== value;
      diagnostics.push({
        code: conflicting ? 'conflicting-property' : 'duplicate-property',
        severity: conflicting ? 'error' : 'warning',
        pagePath,
        line: lineIndex + 1,
        message: conflicting
          ? `Property "${key}" has conflicting values in one block.`
          : `Property "${key}" is duplicated in one block.`,
        details: `${previous.value} / ${value}`,
      });
    } else {
      current.properties.set(key, { value, line: lineIndex + 1 });
    }
  }
}

function referenceDiagnostics(
  content: string,
  pagePath: string,
  diagnostics: ValidationDiagnostic[]
): void {
  for (const [lineIndex, line] of content.split(/\r?\n/u).entries()) {
    const validRanges: [number, number][] = [];
    for (const match of line.matchAll(/\[\[([^\]]+)\]\]/gu)) {
      const target = (match[1] ?? '').split('|')[0]?.trim();
      if (!target) {
        diagnostics.push({
          code: 'malformed-reference',
          severity: 'error',
          pagePath,
          line: lineIndex + 1,
          message: 'Page reference has no target.',
        });
      }
      const start = match.index ?? 0;
      validRanges.push([start, start + match[0].length]);
    }

    let remainder = '';
    let cursor = 0;
    for (const [start, end] of validRanges) {
      remainder += line.slice(cursor, start);
      cursor = end;
    }
    remainder += line.slice(cursor);
    if (/\[\[|\]\]/u.test(remainder)) {
      diagnostics.push({
        code: 'malformed-reference',
        severity: 'error',
        pagePath,
        line: lineIndex + 1,
        message: 'Page reference brackets are not balanced.',
      });
    }
  }
}

function syntaxAndAttachmentDiagnostics(
  content: string,
  pagePath: string,
  diagnostics: ValidationDiagnostic[]
): void {
  const unsupported = [
    { pattern: /^\s*#\+(?:BEGIN|END)_/iu, label: 'Org-mode block' },
    { pattern: /\{\{\s*(?:query|embed|renderer|namespace|eval)\b/iu, label: 'Logseq macro' },
    { pattern: /^\s*:PROPERTIES:\s*$/iu, label: 'Org-mode property drawer' },
    { pattern: /^\s*:\w+:\s*$/u, label: 'Org-mode property drawer' },
    { pattern: /\(\([^)]*\)\)/u, label: 'block reference' },
  ];
  for (const [lineIndex, line] of content.split(/\r?\n/u).entries()) {
    const syntax = unsupported.find(({ pattern }) => pattern.test(line));
    if (syntax) {
      diagnostics.push({
        code: 'unsupported-syntax',
        severity: 'warning',
        pagePath,
        line: lineIndex + 1,
        message: `Unsupported ${syntax.label} syntax may not round-trip through CLI block operations.`,
      });
    }

    const attachment =
      line.match(/!\[[^\]]*\]\(([^)]+)\)/u) ??
      line.match(/\[\[([^\]]+\.(?:png|jpe?g|gif|svg|webp|pdf|mp3|mp4|mov|wav))\]\]/iu);
    if (attachment) {
      diagnostics.push({
        code: 'attachment-reference',
        severity: 'warning',
        pagePath,
        line: lineIndex + 1,
        message: 'Page contains an attachment reference.',
        details: attachment[1]?.trim(),
      });
    }
  }
}

export class GraphStore {
  readonly root: string;
  private rootPromise: Promise<string>;

  constructor(rootPath: string) {
    this.root = resolve(rootPath);
    this.rootPromise = ensureDirectory(this.root);
  }

  private async checkedRoot(): Promise<string> {
    const root = await this.rootPromise;
    if (root !== this.root) {
      // A symlinked graph root is fine; all subsequent checks use its canonical path.
      this.rootPromise = Promise.resolve(root);
    }
    return root;
  }

  private async fileEntries(): Promise<FileEntry[]> {
    return walkGraph(await this.checkedRoot());
  }

  private async safeWriteTarget(relativePath: string): Promise<string> {
    const root = await this.checkedRoot();
    const normalized = normalizeGraphRelativePath(relativePath);
    const lexicalTarget = join(root, normalized);
    if (!isInside(root, lexicalTarget)) throw graphPathError(relativePath);
    await mkdir(dirname(lexicalTarget), { recursive: true });
    const parent = await realpath(dirname(lexicalTarget));
    if (!isInside(root, parent)) throw new Error(`Write path escapes graph root: ${relativePath}`);
    return join(parent, basename(lexicalTarget));
  }

  async pages(): Promise<GraphPage[]> {
    await this.checkedRoot();
    const entries = (await this.fileEntries()).filter(
      (entry) => extname(entry.relativePath).toLocaleLowerCase() === MARKDOWN_EXTENSION
    );
    const inputs: PageInput[] = await Promise.all(
      entries.map(async ({ relativePath, absolutePath }) => ({
        title: titleForPath(relativePath),
        path: relativePath,
        content: await readFile(absolutePath, 'utf8'),
      }))
    );
    return buildPageIndex(inputs)
      .map(toGraphPage)
      .sort(
        (left, right) =>
          left.title.localeCompare(right.title) || left.path.localeCompare(right.path)
      );
  }

  async info(): Promise<GraphInfo> {
    const root = await this.checkedRoot();
    const entries = await this.fileEntries();
    const markdownFiles = entries.filter(
      (entry) => extname(entry.relativePath).toLocaleLowerCase() === MARKDOWN_EXTENSION
    );
    return {
      root,
      pageCount: markdownFiles.length,
      journalCount: markdownFiles.filter((entry) => pageKind(entry.relativePath) === 'journal')
        .length,
      attachmentCount: entries.filter(
        (entry) => extname(entry.relativePath).toLocaleLowerCase() !== MARKDOWN_EXTENSION
      ).length,
      markdownFiles: markdownFiles.length,
    };
  }

  async findPage(reference: string): Promise<GraphPage> {
    const pages = await this.pages();
    const value = safePageReference(reference);
    const path = value.toLocaleLowerCase().endsWith(MARKDOWN_EXTENSION)
      ? normalizeGraphRelativePath(value)
      : undefined;
    const exactPath = path
      ? pages.find((page) => page.path.toLocaleLowerCase() === path.toLocaleLowerCase())
      : undefined;
    const normalized = normalizePageTitle(value);
    const byTitle = pages.filter((page) => page.normalizedTitle === normalized);
    const result = exactPath ?? (byTitle.length === 1 ? byTitle[0] : undefined);
    if (!result) {
      if (byTitle.length > 1) throw new Error(`Page reference is ambiguous: ${reference}`);
      throw new Error(`Page not found: ${reference}`);
    }
    return result;
  }

  async searchBlocks(query: string, pageReference?: string): Promise<BlockSearchResult[]> {
    const needle = query.trim();
    if (!needle) throw new Error('Search query cannot be empty.');
    const pages = pageReference ? [await this.findPage(pageReference)] : await this.pages();
    const index = buildWorkspaceIndex(pages);
    return searchWorkspaceBlocks(index, needle, { limit: 100 }).map((context) =>
      blockResult(context.page, context.block, context.ancestors)
    );
  }

  async backlinks(reference: string): Promise<BacklinkResult[]> {
    const target = await this.findPage(reference);
    const pages = await this.pages();
    const contexts = findContextualBacklinks(buildWorkspaceIndex(pages), target.title);
    const grouped = new Map<string, BacklinkResult>();
    for (const context of contexts) {
      const existing = grouped.get(context.page.path) ?? {
        pagePath: context.page.path,
        pageTitle: context.page.title,
        blocks: [],
      };
      const result = blockResult(context.page, context.block, context.ancestors);
      existing.blocks.push({
        blockId: result.blockId,
        content: result.content,
        ancestors: result.ancestors,
        context: result.context,
      });
      grouped.set(context.page.path, existing);
    }
    return [...grouped.values()].sort((left, right) =>
      left.pageTitle.localeCompare(right.pageTitle)
    );
  }

  async capture(content: string, date = new Date()): Promise<GraphPage> {
    const block = serializeCaptureBlockMarkdown(content);
    const dateText = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
      .map((part) => String(part).padStart(2, '0'))
      .join('-');
    const path = `journals/${dateText.replaceAll('-', '_')}.md`;
    const absolutePath = await this.safeWriteTarget(path);
    const handle = await open(
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
    return this.findPage(path);
  }

  async createPage(title: string, content?: string): Promise<GraphPage> {
    const cleanTitle = title.trim();
    if (!cleanTitle || cleanTitle.includes('\0')) throw new Error('Page title cannot be empty.');
    if (
      /^[\\/]/u.test(cleanTitle) ||
      cleanTitle.split(/[\\/]/u).some((part) => part === '.' || part === '..' || !part)
    ) {
      throw new Error('Page title contains an unsafe path component.');
    }
    const filename = pageFilenameForTitle(cleanTitle);
    const relativePath = `pages/${filename}`;
    const absolutePath = await this.safeWriteTarget(relativePath);
    const existing = await this.pages();
    if (existing.some((page) => page.normalizedTitle === normalizePageTitle(cleanTitle))) {
      throw new Error(`A page named “${cleanTitle}” already exists.`);
    }
    const initial = content === undefined ? '- ' : content;
    await writeFile(absolutePath, initial, { encoding: 'utf8', flag: 'wx' });
    return this.findPage(relativePath);
  }

  async validate(): Promise<ValidationReport> {
    const pages = await this.pages();
    const diagnostics: ValidationDiagnostic[] = [];
    const migration = analyzeMigration(pages).report;
    const byTitle = new Map<string, GraphPage[]>();
    for (const page of pages) {
      const matches = byTitle.get(page.normalizedTitle) ?? [];
      matches.push(page);
      byTitle.set(page.normalizedTitle, matches);
      referenceDiagnostics(page.content, page.path, diagnostics);
      syntaxAndAttachmentDiagnostics(page.content, page.path, diagnostics);
      propertyDiagnostics(page.content, page.path, diagnostics);
    }
    for (const duplicates of byTitle.values()) {
      if (duplicates.length < 2) continue;
      diagnostics.push({
        code: 'duplicate-page',
        severity: 'error',
        message: `Multiple pages normalize to “${duplicates[0]?.normalizedTitle}”.`,
        details: duplicates.map((page) => page.path).join(', '),
      });
    }
    for (const construct of migration.unsupportedConstructs) {
      if (
        diagnostics.some(
          (diagnostic) =>
            diagnostic.code === 'unsupported-syntax' &&
            diagnostic.pagePath === construct.path &&
            diagnostic.line === construct.line
        )
      ) {
        continue;
      }
      diagnostics.push({
        code: 'unsupported-syntax',
        severity: 'warning',
        pagePath: construct.path,
        line: construct.line,
        message: construct.message,
        details: construct.kind,
      });
    }
    diagnostics.sort((left, right) =>
      `${left.pagePath ?? ''}:${left.line ?? 0}:${left.code}`.localeCompare(
        `${right.pagePath ?? ''}:${right.line ?? 0}:${right.code}`
      )
    );
    return {
      root: await this.checkedRoot(),
      checkedPages: pages.length,
      readOnly: true,
      diagnostics,
      summary: {
        errors: diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
        warnings: diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length,
      },
    };
  }
}

export function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error('Date must use YYYY-MM-DD.');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year ?? 0, (month ?? 0) - 1, day ?? 0);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== (month ?? 0) - 1 ||
    date.getDate() !== day
  ) {
    throw new Error(`Invalid date: ${value}`);
  }
  return date;
}

export function formatDiagnostic(diagnostic: ValidationDiagnostic): string {
  const location = diagnostic.pagePath
    ? `${diagnostic.pagePath}${diagnostic.line ? `:${diagnostic.line}` : ''}`
    : 'graph';
  return `${location} [${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}${
    diagnostic.details ? ` (${diagnostic.details})` : ''
  }`;
}
