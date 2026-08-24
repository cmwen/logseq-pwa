import {
  buildPageIndex,
  type FrontmatterData,
  type IndexedPage,
  type PageInput,
  parseFrontmatter,
  splitFrontmatter,
} from '@loam/core';
import { type BlockSearchResult, indexPageBlocks } from './block-index.js';
import { localPageTitleFromPath } from './logseq.js';

/** The persisted subset of a page needed to avoid rereading unchanged files. */
export interface CachedPageState {
  blocks?: BlockSearchResult[];
  content: string;
  frontmatter?: FrontmatterData;
  frontmatterSource?: string;
  lastModified: number;
  path: string;
  size: number;
  title: string;
}

/** A page snapshot reconciled with the current state of the selected graph. */
export interface ReconciledPage extends IndexedPage {
  frontmatter: FrontmatterData;
  frontmatterSource?: string;
  handle: FileSystemFileHandle;
  lastModified: number;
  size: number;
}

export interface ReconciliationProgress {
  checked: number;
  discovered: number;
  path?: string;
}

export interface ReconciliationResult {
  blockIndex: BlockSearchResult[];
  changedPaths: string[];
  deletedPaths: string[];
  pages: ReconciledPage[];
  summary: {
    changed: number;
    deleted: number;
    unchanged: number;
  };
}

export interface ReconciliationOptions {
  /** Reads every file even when its cached filesystem metadata still matches. */
  force?: boolean;
  onProgress?: (progress: ReconciliationProgress) => void;
  signal?: AbortSignal;
}

interface MarkdownEntry {
  file: File;
  handle: FileSystemFileHandle;
  path: string;
}

function frontmatterFor(content: string): {
  frontmatter: FrontmatterData;
  frontmatterSource?: string;
} {
  try {
    const document = parseFrontmatter(content);
    return {
      frontmatter: document.data,
      frontmatterSource: document.source ?? undefined,
    };
  } catch {
    return {
      frontmatter: {},
      frontmatterSource: splitFrontmatter(content).source ?? undefined,
    };
  }
}

async function collectMarkdownEntries(
  directory: FileSystemDirectoryHandle,
  parentPath: string,
  entries: MarkdownEntry[]
): Promise<void> {
  for await (const entry of directory.values()) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

    const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') {
      await collectMarkdownEntries(entry, path, entries);
    } else if (entry.kind === 'file' && entry.name.toLocaleLowerCase().endsWith('.md')) {
      entries.push({ file: await entry.getFile(), handle: entry, path });
    }
  }
}

/**
 * Reconciles a selected graph against cached file metadata.
 *
 * This function is worker-safe. Browser callers should normally use
 * {@link reconcileGraphInWorker} so enumeration and indexing stay off the UI thread.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: One pass coordinates fingerprint reuse, parsing, progress, and delta bookkeeping.
export async function reconcileLogseqFolder(
  root: FileSystemDirectoryHandle,
  cachedPages: readonly CachedPageState[],
  options: ReconciliationOptions = {}
): Promise<ReconciliationResult> {
  const entries: MarkdownEntry[] = [];
  await collectMarkdownEntries(root, '', entries);

  const cachedByPath = new Map(cachedPages.map((page) => [page.path, page]));
  const seenPaths = new Set(entries.map((entry) => entry.path));
  const inputs: PageInput[] = [];
  const blockIndex: BlockSearchResult[] = [];
  const frontmatter = new Map<
    string,
    { frontmatter: FrontmatterData; frontmatterSource?: string }
  >();
  const fileMetadata = new Map<
    string,
    { handle: FileSystemFileHandle; lastModified: number; size: number }
  >();
  let changed = 0;
  let unchanged = 0;
  const changedPaths: string[] = [];

  for (const [index, entry] of entries.entries()) {
    if (options.signal?.aborted) throw new DOMException('Reconciliation cancelled.', 'AbortError');
    const cached = cachedByPath.get(entry.path);
    const canReuse =
      !options.force &&
      cached !== undefined &&
      cached.size === entry.file.size &&
      cached.lastModified === entry.file.lastModified;
    const content = canReuse ? cached.content : await entry.file.text();
    const title = canReuse ? cached.title : localPageTitleFromPath(entry.path);
    const metadata =
      canReuse && cached.frontmatter
        ? {
            frontmatter: cached.frontmatter,
            frontmatterSource: cached.frontmatterSource,
          }
        : frontmatterFor(content);
    inputs.push({ content, path: entry.path, title });
    frontmatter.set(entry.path, metadata);
    blockIndex.push(
      ...(canReuse && cached.blocks
        ? cached.blocks.map((block) => ({ ...block, references: [...block.references] }))
        : indexPageBlocks([{ content, path: entry.path, title }]))
    );
    fileMetadata.set(entry.path, {
      handle: entry.handle,
      lastModified: entry.file.lastModified,
      size: entry.file.size,
    });
    if (canReuse) unchanged += 1;
    else {
      changed += 1;
      changedPaths.push(entry.path);
    }
    options.onProgress?.({ checked: index + 1, discovered: entries.length, path: entry.path });
  }

  const pages = buildPageIndex(inputs)
    .map((page): ReconciledPage => {
      const file = fileMetadata.get(page.path);
      const document = frontmatter.get(page.path) ?? { frontmatter: {} };
      if (!file) throw new Error(`Missing reconciled file metadata for "${page.path}".`);
      return { ...page, ...document, ...file };
    })
    .sort((left, right) => left.title.localeCompare(right.title));

  const deletedPaths = cachedPages
    .filter((page) => !seenPaths.has(page.path))
    .map((page) => page.path);
  return {
    blockIndex,
    changedPaths,
    deletedPaths,
    pages,
    summary: {
      changed,
      deleted: deletedPaths.length,
      unchanged,
    },
  };
}

interface ReconcileWorkerRequest {
  cachedPages: CachedPageState[];
  force: boolean;
  root: FileSystemDirectoryHandle;
  type: 'reconcile';
}

type ReconcileWorkerResponse =
  | { progress: ReconciliationProgress; type: 'progress' }
  | { result: ReconciliationResult; type: 'complete' }
  | { message: string; type: 'error' };

/** Runs graph reconciliation in a short-lived dedicated Web Worker. */
export function reconcileGraphInWorker(
  root: FileSystemDirectoryHandle,
  cachedPages: readonly CachedPageState[],
  options: ReconciliationOptions = {}
): Promise<ReconciliationResult> {
  if (typeof Worker === 'undefined') {
    return reconcileLogseqFolder(root, cachedPages, options);
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./reconciliation.worker.ts', import.meta.url), {
      type: 'module',
    });
    const finish = (): void => {
      options.signal?.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = (): void => {
      finish();
      reject(new DOMException('Reconciliation cancelled.', 'AbortError'));
    };
    if (options.signal?.aborted) {
      abort();
      return;
    }
    options.signal?.addEventListener('abort', abort, { once: true });
    worker.addEventListener('message', (event: MessageEvent<ReconcileWorkerResponse>) => {
      const message = event.data;
      if (message.type === 'progress') {
        options.onProgress?.(message.progress);
      } else if (message.type === 'complete') {
        finish();
        resolve(message.result);
      } else {
        finish();
        reject(new Error(message.message));
      }
    });
    worker.addEventListener('error', (event) => {
      finish();
      reject(new Error(event.message || 'The graph reconciliation worker failed.'));
    });
    const request: ReconcileWorkerRequest = {
      cachedPages: [...cachedPages],
      force: options.force ?? false,
      root,
      type: 'reconcile',
    };
    worker.postMessage(request);
  });
}

export type { ReconcileWorkerRequest, ReconcileWorkerResponse };
