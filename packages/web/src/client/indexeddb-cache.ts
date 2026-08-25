import type { FrontmatterData, IndexedPage } from '@loam/core';
import type { BlockSearchResult } from './block-index.js';

/** Current on-disk schema for the browser graph cache. */
export const GRAPH_CACHE_SCHEMA_VERSION = 2;

/** Current version of the page index produced by Loam. */
export const GRAPH_CACHE_INDEXER_VERSION = 3;

const DEFAULT_DATABASE_NAME = 'loam-graph-cache';
const GRAPHS_STORE = 'graphs';
const PAGES_STORE = 'pages';
const LINK_EDGES_STORE = 'linkEdges';

/** Metadata persisted for a selected graph. */
export interface CachedGraphRecord {
  id: string;
  schemaVersion: number;
  indexerVersion: number;
  lastIndexedAt: number;
  /** The selected directory, when the browser can structured-clone it. */
  rootHandle?: FileSystemDirectoryHandle;
}

/** A page and its parsed index data persisted in the browser cache. */
export interface CachedPageRecord extends IndexedPage {
  /** Parsed block projection so cached startup does not parse the whole graph on the UI thread. */
  blocks?: BlockSearchResult[];
  /** Parsed YAML metadata; the original source is retained for lossless editing. */
  frontmatter?: FrontmatterData;
  frontmatterSource?: string;
  graphId: string;
  size: number;
  lastModified: number;
  /** The page file, when the browser can structured-clone it. */
  fileHandle?: FileSystemFileHandle;
}

/** A normalized outgoing page-link edge used to answer backlinks without scanning pages. */
export interface CachedLinkEdge {
  graphId: string;
  sourcePagePath: string;
  sourcePageTitle: string;
  targetTitleKey: string;
  label: string;
  ordinal: number;
}

/** The complete cached view needed for immediate application startup. */
export interface GraphCacheSnapshot {
  graph?: CachedGraphRecord;
  pages: CachedPageRecord[];
  edges: CachedLinkEdge[];
  status: GraphCacheStatus;
}

/** Reports whether cache data and filesystem handles survive an app restart. */
export interface GraphCacheStatus {
  mode: 'indexeddb' | 'memory';
  handles: 'available' | 'unavailable' | 'unknown';
  warning?: string;
}

/** Options used when opening a graph cache. The factory is injectable for tests. */
export interface GraphCacheOptions {
  databaseName?: string;
  indexedDB?: IDBFactory | null;
}

/** Persistent cache abstraction shared by the app and reconciliation worker. */
export interface GraphCache {
  readonly status: GraphCacheStatus;
  load(graphId: string): Promise<GraphCacheSnapshot>;
  saveGraph(graph: CachedGraphRecord): Promise<void>;
  upsertPage(page: CachedPageRecord): Promise<void>;
  upsertPages(pages: CachedPageRecord[]): Promise<void>;
  /** Atomically replaces one page and all outgoing edges derived from it. */
  replacePageProjection(page: CachedPageRecord, edges: readonly CachedLinkEdge[]): Promise<void>;
  replacePageLinks(
    graphId: string,
    sourcePagePath: string,
    edges: readonly CachedLinkEdge[]
  ): Promise<void>;
  getOutgoingLinks(graphId: string, sourcePagePath: string): Promise<CachedLinkEdge[]>;
  getBacklinks(graphId: string, targetTitleKey: string): Promise<CachedLinkEdge[]>;
  removePage(graphId: string, path: string): Promise<void>;
  removePages(graphId: string, paths: string[]): Promise<void>;
  clearGraph(graphId: string): Promise<void>;
  close(): void;
}

interface MemoryGraph {
  graph?: CachedGraphRecord;
  pages: Map<string, CachedPageRecord>;
  edges: Map<string, CachedLinkEdge>;
}

type StoreName = typeof GRAPHS_STORE | typeof PAGES_STORE | typeof LINK_EDGES_STORE;

function edgeKey(edge: Pick<CachedLinkEdge, 'graphId' | 'sourcePagePath' | 'ordinal'>): string {
  return `${edge.graphId}\u0000${edge.sourcePagePath}\u0000${edge.ordinal}`;
}

function cloneGraph(graph: CachedGraphRecord): CachedGraphRecord {
  return { ...graph };
}

function clonePage(page: CachedPageRecord): CachedPageRecord {
  return {
    ...page,
    links: page.links.map((link) => ({ ...link })),
    backlinks: [...page.backlinks],
    blocks: page.blocks?.map((block) => ({
      ...block,
      references: [...block.references],
    })),
    frontmatter: page.frontmatter ? { ...page.frontmatter } : undefined,
  };
}

function cloneEdge(edge: CachedLinkEdge): CachedLinkEdge {
  return { ...edge };
}

function isCloneError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'DataCloneError'
    : error instanceof Error && error.name === 'DataCloneError';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });
}

function handleCloneFailure(error: unknown): boolean {
  return isCloneError(error) || errorMessage(error).toLocaleLowerCase().includes('clone');
}

/**
 * Opens a cache backed by native IndexedDB, falling back to a process-local cache when the API
 * is unavailable (for example during server-side rendering or in an unsupported browser).
 */
export async function createGraphCache(options: GraphCacheOptions = {}): Promise<GraphCache> {
  const factory =
    options.indexedDB === undefined
      ? typeof indexedDB === 'undefined'
        ? undefined
        : indexedDB
      : (options.indexedDB ?? undefined);

  if (!factory) {
    return new MemoryGraphCache('IndexedDB is unavailable; graph cache will not survive a reload.');
  }

  try {
    const database = await openDatabase(factory, options.databaseName ?? DEFAULT_DATABASE_NAME);
    return new IndexedDbGraphCache(database);
  } catch (error) {
    return new MemoryGraphCache(
      `IndexedDB could not be opened; graph cache will not survive a reload: ${errorMessage(error)}`
    );
  }
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name, GRAPH_CACHE_SCHEMA_VERSION);
    } catch (error) {
      reject(error);
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(GRAPHS_STORE)) {
        database.createObjectStore(GRAPHS_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(PAGES_STORE)) {
        const pages = database.createObjectStore(PAGES_STORE, { keyPath: ['graphId', 'path'] });
        pages.createIndex('byGraph', 'graphId', { unique: false });
      }
      if (!database.objectStoreNames.contains(LINK_EDGES_STORE)) {
        const edges = database.createObjectStore(LINK_EDGES_STORE, {
          keyPath: ['graphId', 'sourcePagePath', 'ordinal'],
        });
        edges.createIndex('byGraph', 'graphId', { unique: false });
        edges.createIndex('bySource', ['graphId', 'sourcePagePath'], { unique: false });
        edges.createIndex('byTarget', ['graphId', 'targetTitleKey'], { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened.'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade is blocked by another tab.'));
  });
}

class MemoryGraphCache implements GraphCache {
  readonly status: GraphCacheStatus;
  private readonly graphs = new Map<string, MemoryGraph>();

  constructor(warning: string) {
    this.status = { mode: 'memory', handles: 'unavailable', warning };
  }

  async load(graphId: string): Promise<GraphCacheSnapshot> {
    const entry = this.graphs.get(graphId);
    return {
      graph: entry?.graph ? cloneGraph(entry.graph) : undefined,
      pages: entry
        ? [...entry.pages.values()].map(clonePage).sort((a, b) => a.path.localeCompare(b.path))
        : [],
      edges: entry
        ? [...entry.edges.values()]
            .map(cloneEdge)
            .sort(
              (a, b) => a.sourcePagePath.localeCompare(b.sourcePagePath) || a.ordinal - b.ordinal
            )
        : [],
      status: this.status,
    };
  }

  async saveGraph(graph: CachedGraphRecord): Promise<void> {
    const entry: MemoryGraph = this.graphs.get(graph.id) ?? { edges: new Map(), pages: new Map() };
    entry.graph = cloneGraph(graph);
    this.graphs.set(graph.id, entry);
  }

  async upsertPage(page: CachedPageRecord): Promise<void> {
    const entry: MemoryGraph = this.graphs.get(page.graphId) ?? {
      edges: new Map(),
      pages: new Map(),
    };
    entry.pages.set(page.path, clonePage(page));
    this.graphs.set(page.graphId, entry);
  }

  async upsertPages(pages: CachedPageRecord[]): Promise<void> {
    for (const page of pages) await this.upsertPage(page);
  }

  async replacePageProjection(
    page: CachedPageRecord,
    edges: readonly CachedLinkEdge[]
  ): Promise<void> {
    const entry: MemoryGraph = this.graphs.get(page.graphId) ?? {
      edges: new Map(),
      pages: new Map(),
    };
    entry.pages.set(page.path, clonePage(page));
    for (const key of entry.edges.keys()) {
      if (key.startsWith(`${page.graphId}\u0000${page.path}\u0000`)) entry.edges.delete(key);
    }
    for (const edge of edges) entry.edges.set(edgeKey(edge), cloneEdge(edge));
    this.graphs.set(page.graphId, entry);
  }

  async replacePageLinks(
    graphId: string,
    sourcePagePath: string,
    edges: readonly CachedLinkEdge[]
  ): Promise<void> {
    const entry: MemoryGraph = this.graphs.get(graphId) ?? { edges: new Map(), pages: new Map() };
    for (const key of entry.edges.keys()) {
      if (key.startsWith(`${graphId}\u0000${sourcePagePath}\u0000`)) entry.edges.delete(key);
    }
    for (const edge of edges) {
      const next = {
        ...edge,
        graphId,
        sourcePagePath,
      };
      entry.edges.set(edgeKey(next), cloneEdge(next));
    }
    this.graphs.set(graphId, entry);
  }

  async getOutgoingLinks(graphId: string, sourcePagePath: string): Promise<CachedLinkEdge[]> {
    const entry = this.graphs.get(graphId);
    if (!entry) return [];
    return [...entry.edges.values()]
      .filter((edge) => edge.graphId === graphId && edge.sourcePagePath === sourcePagePath)
      .map(cloneEdge)
      .sort((a, b) => a.ordinal - b.ordinal);
  }

  async getBacklinks(graphId: string, targetTitleKey: string): Promise<CachedLinkEdge[]> {
    const entry = this.graphs.get(graphId);
    if (!entry) return [];
    return [...entry.edges.values()]
      .filter((edge) => edge.graphId === graphId && edge.targetTitleKey === targetTitleKey)
      .map(cloneEdge)
      .sort((a, b) => a.sourcePagePath.localeCompare(b.sourcePagePath) || a.ordinal - b.ordinal);
  }

  async removePage(graphId: string, path: string): Promise<void> {
    const entry = this.graphs.get(graphId);
    entry?.pages.delete(path);
    if (entry) {
      for (const edge of entry.edges.values()) {
        if (edge.sourcePagePath === path) entry.edges.delete(edgeKey(edge));
      }
    }
  }

  async removePages(graphId: string, paths: string[]): Promise<void> {
    const entry = this.graphs.get(graphId);
    if (!entry) return;
    for (const path of paths) {
      entry.pages.delete(path);
      for (const edge of entry.edges.values()) {
        if (edge.sourcePagePath === path) entry.edges.delete(edgeKey(edge));
      }
    }
  }

  async clearGraph(graphId: string): Promise<void> {
    this.graphs.delete(graphId);
  }

  close(): void {
    // There is no process-local resource to release.
  }
}

class IndexedDbGraphCache implements GraphCache {
  status: GraphCacheStatus = { mode: 'indexeddb', handles: 'unknown' };

  constructor(private readonly database: IDBDatabase) {
    database.onversionchange = () => database.close();
  }

  async load(graphId: string): Promise<GraphCacheSnapshot> {
    const transaction = this.database.transaction(
      [GRAPHS_STORE, PAGES_STORE, LINK_EDGES_STORE],
      'readonly'
    );
    const graphRequest = transaction.objectStore(GRAPHS_STORE).get(graphId);
    const pageRequest = transaction.objectStore(PAGES_STORE).index('byGraph').getAll(graphId);
    const edgeRequest = transaction.objectStore(LINK_EDGES_STORE).index('byGraph').getAll(graphId);
    const [graph, pages, edges] = await Promise.all([
      requestResult(graphRequest),
      requestResult(pageRequest),
      requestResult(edgeRequest),
    ]);
    await transactionComplete(transaction);
    const cachedGraph = graph as CachedGraphRecord | undefined;
    if (cachedGraph?.rootHandle) this.status = { ...this.status, handles: 'available' };
    return {
      graph: cachedGraph,
      pages: (pages as CachedPageRecord[]).sort((a, b) => a.path.localeCompare(b.path)),
      edges: (edges as CachedLinkEdge[]).sort(
        (a, b) => a.sourcePagePath.localeCompare(b.sourcePagePath) || a.ordinal - b.ordinal
      ),
      status: this.status,
    };
  }

  async saveGraph(graph: CachedGraphRecord): Promise<void> {
    if (!graph.rootHandle) {
      await this.put(GRAPHS_STORE, graph);
      return;
    }
    try {
      await this.put(GRAPHS_STORE, graph);
      this.status = { ...this.status, handles: 'available' };
    } catch (error) {
      if (!handleCloneFailure(error)) throw error;
      await this.put(GRAPHS_STORE, { ...graph, rootHandle: undefined });
      this.status = {
        mode: 'indexeddb',
        handles: 'unavailable',
        warning: 'IndexedDB is available, but this browser cannot persist filesystem handles.',
      };
    }
  }

  async upsertPage(page: CachedPageRecord): Promise<void> {
    if (!page.fileHandle) {
      await this.put(PAGES_STORE, page);
      return;
    }
    try {
      await this.put(PAGES_STORE, page);
      this.status = { ...this.status, handles: 'available' };
    } catch (error) {
      if (!handleCloneFailure(error)) throw error;
      await this.put(PAGES_STORE, { ...page, fileHandle: undefined });
      this.status = {
        mode: 'indexeddb',
        handles: 'unavailable',
        warning: 'IndexedDB is available, but this browser cannot persist filesystem handles.',
      };
    }
  }

  async upsertPages(pages: CachedPageRecord[]): Promise<void> {
    // Keep this operation simple and resilient: a handle-clone failure on one page should not
    // discard all other page updates in the transaction.
    for (const page of pages) await this.upsertPage(page);
  }

  async replacePageProjection(
    page: CachedPageRecord,
    edges: readonly CachedLinkEdge[]
  ): Promise<void> {
    try {
      await this.replacePageProjectionValue(page, edges);
      if (page.fileHandle) this.status = { ...this.status, handles: 'available' };
    } catch (error) {
      if (!page.fileHandle || !handleCloneFailure(error)) throw error;
      await this.replacePageProjectionValue({ ...page, fileHandle: undefined }, edges);
      this.status = {
        mode: 'indexeddb',
        handles: 'unavailable',
        warning: 'IndexedDB is available, but this browser cannot persist filesystem handles.',
      };
    }
  }

  async replacePageLinks(
    graphId: string,
    sourcePagePath: string,
    edges: readonly CachedLinkEdge[]
  ): Promise<void> {
    const transaction = this.database.transaction(LINK_EDGES_STORE, 'readwrite');
    const store = transaction.objectStore(LINK_EDGES_STORE);
    const existingKeys = await requestResult(
      store.index('bySource').getAllKeys([graphId, sourcePagePath])
    );
    for (const key of existingKeys) store.delete(key);
    for (const edge of edges) {
      store.put({ ...edge, graphId, sourcePagePath });
    }
    await transactionComplete(transaction);
  }

  async getOutgoingLinks(graphId: string, sourcePagePath: string): Promise<CachedLinkEdge[]> {
    const transaction = this.database.transaction(LINK_EDGES_STORE, 'readonly');
    const request = transaction
      .objectStore(LINK_EDGES_STORE)
      .index('bySource')
      .getAll([graphId, sourcePagePath]);
    const edges = await requestResult(request);
    await transactionComplete(transaction);
    return (edges as CachedLinkEdge[]).sort((a, b) => a.ordinal - b.ordinal);
  }

  async getBacklinks(graphId: string, targetTitleKey: string): Promise<CachedLinkEdge[]> {
    const transaction = this.database.transaction(LINK_EDGES_STORE, 'readonly');
    const request = transaction
      .objectStore(LINK_EDGES_STORE)
      .index('byTarget')
      .getAll([graphId, targetTitleKey]);
    const edges = await requestResult(request);
    await transactionComplete(transaction);
    return (edges as CachedLinkEdge[]).sort(
      (a, b) => a.sourcePagePath.localeCompare(b.sourcePagePath) || a.ordinal - b.ordinal
    );
  }

  async removePage(graphId: string, path: string): Promise<void> {
    const transaction = this.database.transaction([PAGES_STORE, LINK_EDGES_STORE], 'readwrite');
    transaction.objectStore(PAGES_STORE).delete([graphId, path]);
    const edges = transaction.objectStore(LINK_EDGES_STORE);
    const keys = await requestResult(edges.index('bySource').getAllKeys([graphId, path]));
    for (const key of keys) edges.delete(key);
    await transactionComplete(transaction);
  }

  async removePages(graphId: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const transaction = this.database.transaction([PAGES_STORE, LINK_EDGES_STORE], 'readwrite');
    const store = transaction.objectStore(PAGES_STORE);
    const edges = transaction.objectStore(LINK_EDGES_STORE);
    for (const path of paths) {
      store.delete([graphId, path]);
      const keys = await requestResult(edges.index('bySource').getAllKeys([graphId, path]));
      for (const key of keys) edges.delete(key);
    }
    await transactionComplete(transaction);
  }

  async clearGraph(graphId: string): Promise<void> {
    const transaction = this.database.transaction(
      [GRAPHS_STORE, PAGES_STORE, LINK_EDGES_STORE],
      'readwrite'
    );
    transaction.objectStore(GRAPHS_STORE).delete(graphId);
    const pages = transaction.objectStore(PAGES_STORE);
    const keys = await requestResult(pages.index('byGraph').getAllKeys(graphId));
    for (const key of keys) pages.delete(key);
    const edges = transaction.objectStore(LINK_EDGES_STORE);
    const edgeKeys = await requestResult(edges.index('byGraph').getAllKeys(graphId));
    for (const key of edgeKeys) edges.delete(key);
    await transactionComplete(transaction);
  }

  close(): void {
    this.database.close();
  }

  private async put(
    storeName: StoreName,
    value: CachedGraphRecord | CachedPageRecord | CachedLinkEdge
  ): Promise<void> {
    const transaction = this.database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value);
    await transactionComplete(transaction);
  }

  private async replacePageProjectionValue(
    page: CachedPageRecord,
    edges: readonly CachedLinkEdge[]
  ): Promise<void> {
    const transaction = this.database.transaction([PAGES_STORE, LINK_EDGES_STORE], 'readwrite');
    const pages = transaction.objectStore(PAGES_STORE);
    const links = transaction.objectStore(LINK_EDGES_STORE);
    const existingKeys = await requestResult(
      links.index('bySource').getAllKeys([page.graphId, page.path])
    );
    pages.put(page);
    for (const key of existingKeys) links.delete(key);
    for (const edge of edges) links.put(edge);
    await transactionComplete(transaction);
  }
}
