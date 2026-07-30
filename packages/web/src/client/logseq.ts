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
      title: pageTitleFromPath(relativePath),
      path: relativePath,
      content: await file.text(),
    });
    handles.set(relativePath, entry);
  }
}

export async function savePage(page: LocalPage, content: string): Promise<void> {
  if (!page.handle) {
    throw new Error('Demo pages are read-only. Open a local Logseq folder to save changes.');
  }

  const writable = await page.handle.createWritable();
  await writable.write(content);
  await writable.close();
}

export async function createPageFile(
  root: FileSystemDirectoryHandle,
  title: string
): Promise<void> {
  const pagesDirectory = await root.getDirectoryHandle('pages', { create: true });
  const filename = `${title
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
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
