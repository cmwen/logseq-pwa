import { buildPageIndex, type IndexedPage, type PageInput, pageTitleFromPath } from '@loam/core';

export interface LocalPage extends IndexedPage {
  handle?: FileSystemFileHandle;
}

interface DirectoryPickerOptions {
  mode?: 'read' | 'readwrite';
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
  }
}

export function supportsFolderAccess(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

function journalDateParts(date: Date): { day: string; month: string; year: string } {
  return {
    day: String(date.getDate()).padStart(2, '0'),
    month: String(date.getMonth() + 1).padStart(2, '0'),
    year: String(date.getFullYear()),
  };
}

/** Returns the portable Logseq journal path for a date in the user's local timezone. */
export function journalPathForDate(date = new Date()): string {
  const { day, month, year } = journalDateParts(date);
  return `journals/${year}_${month}_${day}.md`;
}

/** Returns the ISO journal label for a date in the user's local timezone. */
export function journalTitleForDate(date = new Date()): string {
  const { day, month, year } = journalDateParts(date);
  return `${year}-${month}-${day}`;
}

export function findJournalByDate(pages: LocalPage[], date = new Date()): LocalPage | undefined {
  const targetPath = journalPathForDate(date).toLocaleLowerCase();
  return pages.find((page) => page.path.toLocaleLowerCase() === targetPath);
}

/** Uses an ISO date as the logical page identity for journal filenames. */
export function localPageTitleFromPath(path: string): string {
  const journal = path.match(/^journals\/(\d{4})[_-](\d{2})[_-](\d{2})\.md$/i);
  return journal ? `${journal[1]}-${journal[2]}-${journal[3]}` : pageTitleFromPath(path);
}

export async function pickLogseqFolder(): Promise<FileSystemDirectoryHandle> {
  if (!window.showDirectoryPicker) {
    throw new Error(
      'Folder access is not supported in this browser. Try Chrome or Edge on desktop.'
    );
  }

  return window.showDirectoryPicker({ mode: 'readwrite' });
}

export async function readLogseqFolder(root: FileSystemDirectoryHandle): Promise<LocalPage[]> {
  const inputs: PageInput[] = [];
  const handles = new Map<string, FileSystemFileHandle>();
  await collectMarkdownFiles(root, '', inputs, handles);

  return buildPageIndex(inputs)
    .map((page) => ({ ...page, handle: handles.get(page.path) }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

async function collectMarkdownFiles(
  directory: FileSystemDirectoryHandle,
  parentPath: string,
  inputs: PageInput[],
  handles: Map<string, FileSystemFileHandle>
): Promise<void> {
  for await (const entry of directory.values()) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue;
    }

    const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') {
      await collectMarkdownFiles(entry, relativePath, inputs, handles);
      continue;
    }

    if (entry.kind !== 'file' || !entry.name.toLocaleLowerCase().endsWith('.md')) {
      continue;
    }

    const file = await entry.getFile();
    inputs.push({
      title: localPageTitleFromPath(relativePath),
      path: relativePath,
      content: await file.text(),
    });
    handles.set(relativePath, entry);
  }
}

export async function savePage(
  page: LocalPage,
  content: string,
  expectedContent?: string
): Promise<void> {
  if (!page.handle) {
    throw new Error('Demo pages are read-only. Open a local Logseq folder to save changes.');
  }

  if (expectedContent !== undefined) {
    const currentContent = await (await page.handle.getFile()).text();
    if (currentContent !== expectedContent) {
      throw new Error(
        'This page changed on disk while you were editing. Refresh the graph before saving.'
      );
    }
  }

  const writable = await page.handle.createWritable();
  await writable.write(content);
  await writable.close();
}

/** Creates today's journal lazily and returns its file handle. */
export async function ensureJournalFile(
  root: FileSystemDirectoryHandle,
  date = new Date()
): Promise<FileSystemFileHandle> {
  const journalsDirectory = await root.getDirectoryHandle('journals', { create: true });
  const filename = journalPathForDate(date).split('/').pop();
  if (!filename) throw new Error('Could not resolve the journal filename.');
  return journalsDirectory.getFileHandle(filename, { create: true });
}

/** Appends a top-level block to a journal after reading the latest content from disk. */
export async function appendJournalCapture(
  root: FileSystemDirectoryHandle,
  content: string,
  date = new Date()
): Promise<void> {
  const trimmed = content.trim();
  if (!trimmed) return;

  const handle = await ensureJournalFile(root, date);
  const current = await (await handle.getFile()).text();
  const separator = current.length === 0 || current.endsWith('\n') ? '' : '\n';
  const writable = await handle.createWritable();
  await writable.write(`${current}${separator}- ${trimmed}\n`);
  await writable.close();
}

export async function createPageFile(
  root: FileSystemDirectoryHandle,
  title: string
): Promise<void> {
  const pagesDirectory = await root.getDirectoryHandle('pages', { create: true });
  const filename = `${title
    .trim()
    .replaceAll('/', '___')
    .replace(/[\\:*?"<>|]/g, '-')
    .replace(/\s+/g, '_')}.md`;
  let file: FileSystemFileHandle;
  try {
    await pagesDirectory.getFileHandle(filename);
    throw new Error(`A page named “${title.trim()}” already exists.`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('already exists')) {
      throw error;
    }
    if (!(error instanceof DOMException) || error.name !== 'NotFoundError') {
      throw error;
    }
    file = await pagesDirectory.getFileHandle(filename, { create: true });
  }
  const writable = await file.createWritable();
  await writable.write(`# ${title.trim()}\n\n- `);
  await writable.close();
}
