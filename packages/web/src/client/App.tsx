import {
  buildPageIndex,
  extractPageLinks,
  normalizePageTitle,
  type PageInput,
  pageFilenameForTitle,
  parseFrontmatter,
  splitFrontmatter,
} from '@loam/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { type BlockSearchResult, indexPageBlocks, searchPageBlocks } from './block-index.js';
import { markdownFromClipboard } from './clipboard-markdown.js';
import {
  buildPageHierarchy,
  buildTagSummaries,
  type PageHierarchyNode,
  pageBreadcrumbs,
  parseDatePrimitive,
  type TagSummary,
} from './graph-model.js';
import {
  type CachedLinkEdge,
  type CachedPageRecord,
  createGraphCache,
  GRAPH_CACHE_INDEXER_VERSION,
  GRAPH_CACHE_SCHEMA_VERSION,
  type GraphCache,
  type GraphCacheSnapshot,
} from './indexeddb-cache.js';
import {
  appendJournalCapture,
  createPageFile,
  ensureJournalFile,
  findJournalByDate,
  journalPathForDate,
  journalTitleForDate,
  type LocalPage,
  pickLogseqFolder,
  queryFolderPermission,
  requestFolderPermission,
  savePage,
  supportsFolderAccess,
} from './logseq.js';
import { MarkdownBody } from './MarkdownBody.js';
import {
  createBlockNavigationTarget,
  filterCommandPaletteItems,
  rememberSearchQuery,
} from './navigation-model.js';
import { OutlinerEditor } from './OutlinerEditor.js';
import {
  assessOutlinerSafety,
  type OutlinerBlock,
  parseMarkdownBlocks,
  serializeMarkdownBlocks,
} from './outliner-model.js';
import {
  type CachedPageState,
  type ReconciliationResult,
  reconcileGraphInWorker,
} from './reconciliation.js';
import './styles.css';

const todayTitle = journalTitleForDate();
const activeGraphId = 'last-opened';
const reconciliationStaleAfterMs = 5 * 60 * 1000;

function dateFromPageTitle(title: string): Date | undefined {
  const parsed = parseDatePrimitive(title);
  if (!parsed) return undefined;
  const year = parsed.getUTCFullYear();
  const month = parsed.getUTCMonth() + 1;
  const day = parsed.getUTCDate();
  const date = new Date(year, month - 1, day, 12);
  return date;
}

function pageReferenceKey(title: string): string {
  const date = parseDatePrimitive(title);
  return date ? date.toISOString().slice(0, 10) : normalizePageTitle(title);
}

const demoPages: PageInput[] = [
  {
    title: todayTitle,
    path: journalPathForDate(),
    content:
      '- Welcome to your daily journal\n  - Press Enter to create a block\n  - Press Tab to nest it beneath the previous thought\n- Explore [[Projects/Loam]] @today\n- Try the editor, then open your local graph when you are ready.\n',
  },
  {
    title: 'Welcome to Loam',
    path: 'pages/Welcome_to_Loam.md',
    content:
      '- A small, local-first outliner for your knowledge workspace.\n  - Everything here is a real page link: [[Working set]] and [[Reading list]].\n  - Open your own folder when you are ready.\n- Loam keeps pages, backlinks, and the texture of your daily notes close at hand.\n  - Your files stay exactly where they are.\n',
  },
  {
    title: 'Working set',
    path: 'pages/Working_set.md',
    content:
      '- TODO Sketch the first release\n  - DONE Set up local folder access\n  - TODO Link the page view to [[Reading list]]\n- The best next step is usually the one that makes the graph feel more alive.\n  - See [[Welcome to Loam]] for the short tour.\n  - Follow the hierarchy into [[Projects/Loam]].\n',
  },
  {
    title: 'Projects/Loam',
    path: 'pages/Projects___Loam.md',
    content: `# Loam roadmap

A page can mix Markdown primitives with connected blocks.

- Make relationships visible @project
- Next review: [[${todayTitle}]]
`,
  },
  {
    title: 'Reading list',
    path: 'pages/Reading_list.md',
    content:
      '- [[The Art of Noticing]] — a reminder to look slowly\n- [[Designing for calm]] — notes on humane interfaces\n- @someday\n  - This page is linked from [[Working set]].\n  - Unknown links remain visible and ready to become pages.\n',
  },
  {
    title: 'The Art of Noticing',
    path: 'pages/The_Art_of_Noticing.md',
    content:
      '- A page can be a place to return to, not just a container for facts.\n  - Capture the small details before they disappear.\n- Back to [[Reading list]].\n',
  },
  {
    title: 'Designing for calm',
    path: 'pages/Designing_for_calm.md',
    content:
      '- Make the next action obvious\n- Give information room to breathe\n- Keep the user close to their source of truth\n  - Related: [[Reading list]] and [[Welcome to Loam]].\n',
  },
];

const demoIndex = buildPageIndex(demoPages);
const demoBlockIndex = indexPageBlocks(demoIndex);

type IconName =
  | 'arrow'
  | 'book'
  | 'check'
  | 'chevron'
  | 'close'
  | 'edit'
  | 'folder'
  | 'link'
  | 'moon'
  | 'plus'
  | 'refresh'
  | 'search'
  | 'spark'
  | 'sun'
  | 'tag';

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = {
    fill: 'none',
    height: size,
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.8,
    viewBox: '0 0 24 24',
    width: size,
  };

  switch (name) {
    case 'arrow':
      return (
        <svg aria-hidden='true' {...common}>
          <path d='M5 12h13M13 6l6 6-6 6' />
        </svg>
      );
    case 'book':
      return (
        <svg aria-hidden='true' {...common}>
          <path d='M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z' />
          <path d='M4 5.5v16M8 7h8M8 11h7' />
        </svg>
      );
    case 'check':
      return (
        <svg aria-hidden='true' {...common}>
          <path d='m5 12 4 4L19 6' />
        </svg>
      );
    case 'chevron':
      return (
        <svg aria-hidden='true' {...common}>
          <path d='m9 18 6-6-6-6' />
        </svg>
      );
    case 'close':
      return (
        <svg aria-hidden='true' {...common}>
          <path d='m6 6 12 12M18 6 6 18' />
        </svg>
      );
    case 'edit':
      return (
        <svg aria-hidden='true' {...common}>
          <path d='m4 16.5-.8 3.3 3.3-.8L18 7.5 15.5 5zM14.5 6l3.5 3.5' />
        </svg>
      );
    case 'folder':
      return (
        <svg aria-hidden='true' {...common}>
          <path d='M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z' />
        </svg>
      );
    case 'link':
      return (
        <svg aria-hidden='true' {...common}>
          <path d='M10 13.5 14 10M7.5 17.5l-1 1a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0M16.5 6.5l1-1a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0' />
        </svg>
      );
    case 'moon':
      return (
        <svg aria-hidden='true' {...common}>
          <path d='M20 15.2A8.2 8.2 0 0 1 8.8 4a8.2 8.2 0 1 0 11.2 11.2z' />
        </svg>
      );
    case 'plus':
      return (
        <svg aria-hidden='true' {...common}>
          <path d='M12 5v14M5 12h14' />
        </svg>
      );
    case 'refresh':
      return (
        <svg aria-hidden='true' {...common}>
          <path d='M20 11a8 8 0 0 0-14.9-3M4 5v4h4M4 13a8 8 0 0 0 14.9 3M20 19v-4h-4' />
        </svg>
      );
    case 'search':
      return (
        <svg aria-hidden='true' {...common}>
          <circle cx='10.8' cy='10.8' r='6.8' />
          <path d='m16 16 4.5 4.5' />
        </svg>
      );
    case 'spark':
      return (
        <svg aria-hidden='true' {...common}>
          <path d='m12 3 1.2 5.8L19 10l-5.8 1.2L12 17l-1.2-5.8L5 10l5.8-1.2zM19 16l.5 2.5L22 19l-2.5.5L19 22l-.5-2.5L16 19l2.5-.5z' />
        </svg>
      );
    case 'sun':
      return (
        <svg aria-hidden='true' {...common}>
          <circle cx='12' cy='12' r='3.5' />
          <path d='M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' />
        </svg>
      );
    case 'tag':
      return (
        <svg aria-hidden='true' {...common}>
          <path d='M20 13 13 20l-9-9V4h7z' />
          <circle cx='8' cy='8' r='1.2' />
        </svg>
      );
  }
}

function reindexChangedPage(
  pages: readonly LocalPage[],
  changedPath: string,
  content: string,
  file?: File
): LocalPage[] {
  const source = pages.find((page) => page.path === changedPath);
  if (!source) return [...pages];
  const previousTargets = new Set(source.links.map((link) => pageReferenceKey(link.target)));
  const links = extractPageLinks(content);
  const nextTargets = new Set(links.map((link) => pageReferenceKey(link.target)));
  const sourceTitleKey = pageReferenceKey(source.title);
  let frontmatter = {};
  let frontmatterSource = splitFrontmatter(content).source ?? undefined;
  try {
    const document = parseFrontmatter(content);
    frontmatter = document.data;
    frontmatterSource = document.source ?? undefined;
  } catch {
    // Malformed metadata remains editable in raw mode and is preserved verbatim.
  }

  return pages.map((page) => {
    const target = pageReferenceKey(page.title);
    const backlinks = new Set(page.backlinks);
    if (previousTargets.has(target) && !nextTargets.has(target)) backlinks.delete(source.title);
    if (nextTargets.has(target) && target !== sourceTitleKey) backlinks.add(source.title);
    return {
      ...page,
      backlinks: [...backlinks].sort((left, right) => left.localeCompare(right)),
      ...(page.path === changedPath
        ? {
            content,
            frontmatter,
            frontmatterSource,
            lastModified: file?.lastModified ?? page.lastModified,
            links,
            size: file?.size ?? page.size,
          }
        : {}),
    };
  });
}

function cachedPagesToLocal(
  pages: readonly CachedPageRecord[],
  edges: readonly CachedLinkEdge[] = []
): LocalPage[] {
  const backlinksByTarget = new Map<string, Set<string>>();
  for (const edge of edges) {
    const backlinks = backlinksByTarget.get(edge.targetTitleKey) ?? new Set<string>();
    backlinks.add(edge.sourcePageTitle);
    backlinksByTarget.set(edge.targetTitleKey, backlinks);
  }
  return pages.map(({ blocks: _blocks, fileHandle, graphId: _graphId, ...page }) => ({
    ...page,
    backlinks: [...(backlinksByTarget.get(pageReferenceKey(page.title)) ?? [])].sort(
      (left, right) => left.localeCompare(right)
    ),
    handle: fileHandle,
  }));
}

function localPageToCached(
  page: LocalPage,
  blocks: readonly BlockSearchResult[] = []
): CachedPageRecord | undefined {
  if (page.lastModified === undefined || page.size === undefined) return undefined;
  return {
    backlinks: [...page.backlinks],
    blocks: blocks.map((block) => ({ ...block, references: [...block.references] })),
    content: page.content,
    fileHandle: page.handle,
    frontmatter: page.frontmatter ? { ...page.frontmatter } : undefined,
    frontmatterSource: page.frontmatterSource,
    graphId: activeGraphId,
    lastModified: page.lastModified,
    links: page.links.map((link) => ({ ...link })),
    path: page.path,
    size: page.size,
    title: page.title,
  };
}

function pageLinkEdges(page: LocalPage): CachedLinkEdge[] {
  return page.links.map((link, ordinal) => ({
    graphId: activeGraphId,
    label: link.label,
    ordinal,
    sourcePagePath: page.path,
    sourcePageTitle: page.title,
    targetTitleKey: pageReferenceKey(link.target),
  }));
}

function cachedState(
  pages: readonly LocalPage[],
  blocks: readonly BlockSearchResult[]
): CachedPageState[] {
  const groupedBlocks = groupBlocksByPage(blocks);
  return pages.flatMap((page) => {
    if (page.lastModified === undefined || page.size === undefined) return [];
    return [
      {
        content: page.content,
        blocks: groupedBlocks.get(page.path) ?? [],
        lastModified: page.lastModified,
        frontmatter: page.frontmatter ? { ...page.frontmatter } : undefined,
        frontmatterSource: page.frontmatterSource,
        path: page.path,
        size: page.size,
        title: page.title,
      },
    ];
  });
}

function groupBlocksByPage(blocks: readonly BlockSearchResult[]): Map<string, BlockSearchResult[]> {
  const grouped = new Map<string, BlockSearchResult[]>();
  for (const block of blocks) {
    const pageBlocks = grouped.get(block.pagePath) ?? [];
    pageBlocks.push(block);
    grouped.set(block.pagePath, pageBlocks);
  }
  return grouped;
}

function groupBacklinkBlocks(
  blocks: readonly BlockSearchResult[]
): Map<string, BlockSearchResult[]> {
  const grouped = new Map<string, BlockSearchResult[]>();
  for (const block of blocks) {
    const targets = new Set(block.references.map(pageReferenceKey));
    for (const target of targets) {
      const backlinks = grouped.get(target) ?? [];
      backlinks.push(block);
      grouped.set(target, backlinks);
    }
  }
  return grouped;
}

async function isSameDirectory(
  left: FileSystemDirectoryHandle | undefined,
  right: FileSystemDirectoryHandle
): Promise<boolean> {
  if (!left) return false;
  try {
    return await left.isSameEntry(right);
  } catch {
    return false;
  }
}

async function loadRecoverableSnapshot(cache: GraphCache): Promise<GraphCacheSnapshot> {
  try {
    return await cache.load(activeGraphId);
  } catch {
    await cache.clearGraph(activeGraphId);
    return { edges: [], pages: [], status: cache.status };
  }
}

interface PaletteCommand {
  description: string;
  icon: IconName;
  id: string;
  label: string;
  run: () => void | Promise<void>;
  shortcut?: string;
}

function EmptyState({ onOpen, supported }: { onOpen: () => void; supported: boolean }) {
  return (
    <div className='empty-state'>
      <div className='empty-orbit'>
        <Icon name='spark' size={27} />
      </div>
      <p className='eyebrow'>YOUR GRAPH, YOUR SPACE</p>
      <h2>Make your notes feel connected.</h2>
      <p className='empty-copy'>
        Open a Logseq graph from your computer to read pages, follow links, and edit without
        uploading anything.
      </p>
      <button className='button button-primary' onClick={onOpen} type='button'>
        <Icon name='folder' size={17} />
        Open Logseq folder
        <Icon name='arrow' size={16} />
      </button>
      {!supported && <p className='support-note'>Folder access needs Chrome or Edge on desktop.</p>}
    </div>
  );
}

function flattenHierarchy(nodes: readonly PageHierarchyNode[]): PageHierarchyNode[] {
  return nodes.flatMap((node) => [node, ...flattenHierarchy(node.children)]);
}

function TagsView({
  activeTag,
  onOpenPage,
  onSelectTag,
  pages,
  summaries,
}: {
  activeTag: string;
  onOpenPage: (title: string) => void;
  onSelectTag: (tag: string) => void;
  pages: readonly LocalPage[];
  summaries: readonly TagSummary[];
}) {
  const selected = summaries.find((summary) => summary.tag === activeTag);
  const pagePaths = selected
    ? selected.pagePaths
    : [...new Set(summaries.flatMap((summary) => summary.pagePaths))];
  const taggedPages = pagePaths.flatMap((path) => {
    const page = pages.find((candidate) => candidate.path === path);
    return page ? [page] : [];
  });

  return (
    <article className='page-card tags-page'>
      <div className='tags-heading'>
        <div>
          <p className='page-kicker'>TAG INDEX</p>
          <h1>{selected ? `@${selected.tag}` : 'Tags'}</h1>
        </div>
        <div className='page-stats'>
          <span>
            <Icon name='tag' size={14} /> {summaries.length} tags
          </span>
          <span>{taggedPages.length} pages</span>
        </div>
      </div>
      {summaries.length ? (
        <>
          <fieldset className='tag-cloud'>
            <legend className='sr-only'>Tags in this graph</legend>
            <button
              className={`tag-filter ${activeTag ? '' : 'tag-filter-active'}`}
              onClick={() => onSelectTag('')}
              type='button'
            >
              All <small>{summaries.length}</small>
            </button>
            {summaries.map((summary) => (
              <button
                aria-pressed={summary.tag === activeTag}
                className={`tag-filter ${summary.tag === activeTag ? 'tag-filter-active' : ''}`}
                key={summary.tag}
                onClick={() => onSelectTag(summary.tag)}
                type='button'
              >
                @{summary.tag} <small>{summary.pageCount}</small>
              </button>
            ))}
          </fieldset>
          <fieldset className='tag-page-list'>
            <legend className='sr-only'>Pages with selected tag</legend>
            {taggedPages.map((page) => (
              <button
                className='tag-page-card'
                key={page.path}
                onClick={() => onOpenPage(page.title)}
                type='button'
              >
                <Icon name='book' size={16} />
                <span className='tag-page-card-copy'>
                  <strong>{page.title}</strong>
                  <small>{page.path}</small>
                </span>
                <Icon name='chevron' size={14} />
              </button>
            ))}
          </fieldset>
        </>
      ) : (
        <p className='relation-empty'>No tags yet. Add @tags to any block to see them here.</p>
      )}
    </article>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The app shell intentionally keeps the local graph workflow in one place.
export function App() {
  const [root, setRoot] = useState<FileSystemDirectoryHandle>();
  const [pages, setPages] = useState<LocalPage[]>(demoIndex);
  const [blockIndex, setBlockIndex] = useState<BlockSearchResult[]>(demoBlockIndex);
  const [selectedTitle, setSelectedTitle] = useState(todayTitle);
  const [search, setSearch] = useState('');
  const [isDemo, setIsDemo] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [editorBlocks, setEditorBlocks] = useState<OutlinerBlock[]>([]);
  const [editorKind, setEditorKind] = useState<'outliner' | 'raw'>('outliner');
  const [editorFinalNewline, setEditorFinalNewline] = useState(false);
  const [editorFrontmatter, setEditorFrontmatter] = useState('');
  const [focusedBlockId, setFocusedBlockId] = useState<string>();
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [syncStatus, setSyncStatus] = useState('');
  const [hasFolderPermission, setHasFolderPermission] = useState(false);
  const [newPageTitle, setNewPageTitle] = useState('');
  const [captureText, setCaptureText] = useState('');
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isCreatePageOpen, setIsCreatePageOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteSelection, setPaletteSelection] = useState(0);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'light';
    const saved = window.localStorage.getItem('loam:theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [viewMode, setViewMode] = useState<'page' | 'tags'>('page');
  const [activeTag, setActiveTag] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const commandInput = useRef<HTMLInputElement>(null);
  const createPageInput = useRef<HTMLInputElement>(null);
  const cachePromise = useRef<Promise<GraphCache> | null>(null);
  const cacheWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const pagesRef = useRef<LocalPage[]>(demoIndex);
  const blockIndexRef = useRef<BlockSearchResult[]>(demoBlockIndex);
  const reconciliationAbort = useRef<AbortController | null>(null);
  const reconciliationGeneration = useRef(0);
  const lastReconciledAt = useRef(0);

  const selectedPage = pages.find((page) => page.title === selectedTitle) ?? pages[0];
  const filteredPages = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return pages;
    return pages.filter((page) => `${page.title} ${page.path}`.toLocaleLowerCase().includes(query));
  }, [pages, search]);
  const hierarchyRows = useMemo(
    () => flattenHierarchy(buildPageHierarchy(filteredPages).roots),
    [filteredPages]
  );
  const tagSummaries = useMemo(() => buildTagSummaries(pages), [pages]);
  const blockSearchResults = useMemo(
    () => searchPageBlocks(blockIndex, search),
    [blockIndex, search]
  );
  const backlinkBlocks = useMemo(() => groupBacklinkBlocks(blockIndex), [blockIndex]);
  const selectedBacklinks = useMemo(() => {
    if (!selectedPage) return [];
    return (backlinkBlocks.get(pageReferenceKey(selectedPage.title)) ?? []).slice(0, 30);
  }, [backlinkBlocks, selectedPage]);
  const journalPages = useMemo(
    () =>
      pages
        .filter((page) => page.path.toLocaleLowerCase().startsWith('journals/'))
        .sort((left, right) => left.path.localeCompare(right.path)),
    [pages]
  );
  const selectedJournalIndex = selectedPage
    ? journalPages.findIndex((page) => page.path === selectedPage.path)
    : -1;
  const selectedBreadcrumbs = selectedPage ? pageBreadcrumbs(selectedPage.title) : [];
  const supported = supportsFolderAccess();
  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 4200);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem('loam:theme', theme);
  }, [theme]);

  const ensureFolderAccess = useCallback(
    async (handle: FileSystemDirectoryHandle): Promise<boolean> => {
      const granted = await requestFolderPermission(handle);
      setHasFolderPermission(granted);
      if (!granted) showNotice('Folder access is needed to change this graph.');
      return granted;
    },
    [showNotice]
  );

  const getCache = useCallback((): Promise<GraphCache> => {
    cachePromise.current ??= createGraphCache();
    return cachePromise.current;
  }, []);

  const enqueueCacheWrite = useCallback((write: () => Promise<void>): Promise<void> => {
    const queued = cacheWriteQueue.current.catch(() => undefined).then(write);
    cacheWriteQueue.current = queued.catch(() => undefined);
    return queued;
  }, []);

  const replacePages = useCallback((next: LocalPage[]): void => {
    pagesRef.current = next;
    setPages(next);
  }, []);

  const replaceBlockIndex = useCallback((next: BlockSearchResult[]): void => {
    blockIndexRef.current = next;
    setBlockIndex(next);
  }, []);

  const persistReconciliation = useCallback(
    async (
      cache: GraphCache,
      rootHandle: FileSystemDirectoryHandle,
      result: ReconciliationResult
    ): Promise<void> => {
      const blocksByPage = groupBlocksByPage(result.blockIndex);
      const pagesByPath = new Map(result.pages.map((page) => [page.path, page]));
      for (const path of result.changedPaths) {
        const page = pagesByPath.get(path);
        if (!page) continue;
        const record = localPageToCached(page, blocksByPage.get(path) ?? []);
        if (record) await cache.replacePageProjection(record, pageLinkEdges(page));
      }
      await cache.removePages(activeGraphId, result.deletedPaths);
      await cache.saveGraph({
        id: activeGraphId,
        indexerVersion: GRAPH_CACHE_INDEXER_VERSION,
        lastIndexedAt: Date.now(),
        rootHandle,
        schemaVersion: GRAPH_CACHE_SCHEMA_VERSION,
      });
    },
    []
  );

  const reconcileFolder = useCallback(
    async (
      rootHandle: FileSystemDirectoryHandle,
      previous: readonly LocalPage[],
      force = false
    ): Promise<LocalPage[]> => {
      reconciliationAbort.current?.abort();
      const controller = new AbortController();
      reconciliationAbort.current = controller;
      const generation = reconciliationGeneration.current + 1;
      reconciliationGeneration.current = generation;
      setSyncStatus('Checking graph for changes…');
      try {
        const result = await reconcileGraphInWorker(
          rootHandle,
          cachedState(previous, blockIndexRef.current),
          {
            force,
            signal: controller.signal,
            onProgress: ({ checked, discovered }) => {
              if (generation !== reconciliationGeneration.current) return;
              if (checked === discovered || checked % 25 === 0) {
                setSyncStatus(`Checking graph… ${checked}/${discovered}`);
              }
            },
          }
        );
        if (generation !== reconciliationGeneration.current) return pagesRef.current;
        const nextPages: LocalPage[] = result.pages;
        replacePages(nextPages);
        replaceBlockIndex(result.blockIndex);
        const cache = await getCache();
        await enqueueCacheWrite(() => persistReconciliation(cache, rootHandle, result));
        if (generation !== reconciliationGeneration.current) return pagesRef.current;
        lastReconciledAt.current = Date.now();
        return nextPages;
      } finally {
        if (generation === reconciliationGeneration.current) {
          reconciliationAbort.current = null;
          setSyncStatus('');
        }
      }
    },
    [enqueueCacheWrite, getCache, persistReconciliation, replaceBlockIndex, replacePages]
  );

  const applySavedPage = useCallback(
    async (saved: LocalPage, content: string): Promise<void> => {
      reconciliationGeneration.current += 1;
      reconciliationAbort.current?.abort();
      reconciliationAbort.current = null;
      setSyncStatus('');
      const file = saved.handle ? await saved.handle.getFile() : undefined;
      const next = reindexChangedPage(pagesRef.current, saved.path, content, file);
      replacePages(next);
      const updated = next.find((page) => page.path === saved.path);
      const nextBlocks = [
        ...blockIndexRef.current.filter((block) => block.pagePath !== saved.path),
        ...(updated ? indexPageBlocks([updated]) : []),
      ];
      replaceBlockIndex(nextBlocks);
      const record = updated
        ? localPageToCached(
            updated,
            nextBlocks.filter((block) => block.pagePath === saved.path)
          )
        : undefined;
      if (record && updated) {
        const cache = await getCache();
        await enqueueCacheWrite(() => cache.replacePageProjection(record, pageLinkEdges(updated)));
      }
    },
    [enqueueCacheWrite, getCache, replaceBlockIndex, replacePages]
  );

  const openCommandPalette = useCallback(() => {
    setPaletteQuery('');
    setPaletteSelection(0);
    setIsCommandPaletteOpen(true);
  }, []);

  const closeCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen(false);
    setPaletteQuery('');
    setPaletteSelection(0);
  }, []);

  const launchNewPage = useCallback(
    (title = '') => {
      closeCommandPalette();
      if (!root) {
        showNotice('Open a local Logseq folder before creating a page.');
        return;
      }
      setNewPageTitle(title);
      setIsCreatePageOpen(true);
    },
    [closeCommandPalette, root, showNotice]
  );

  useEffect(() => {
    let active = true;
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Cache restoration coordinates version checks, permission recovery, and worker startup in one lifecycle.
    void (async () => {
      try {
        const cache = await getCache();
        const snapshot = await loadRecoverableSnapshot(cache);
        if (!active) return;
        const compatible =
          snapshot.graph?.schemaVersion === GRAPH_CACHE_SCHEMA_VERSION &&
          snapshot.graph.indexerVersion === GRAPH_CACHE_INDEXER_VERSION;
        if (snapshot.graph && !compatible) {
          await cache.clearGraph(activeGraphId);
          return;
        }
        if (!snapshot.graph && snapshot.pages.length === 0) return;

        const restoredPages = cachedPagesToLocal(snapshot.pages, snapshot.edges);
        const restoredBlocks = snapshot.pages.flatMap((page) => page.blocks ?? []);
        replacePages(restoredPages);
        replaceBlockIndex(restoredBlocks);
        setSelectedTitle((findJournalByDate(restoredPages) ?? restoredPages[0])?.title ?? '');
        setFocusedBlockId(undefined);
        setIsDemo(false);
        const restoredRoot = snapshot.graph?.rootHandle;
        if (!restoredRoot) {
          setSyncStatus('Cached graph · reconnect folder to check for changes');
          return;
        }
        setRoot(restoredRoot);
        const permission = await queryFolderPermission(restoredRoot);
        if (!active) return;
        const granted = permission === 'granted';
        setHasFolderPermission(granted);
        if (!granted) {
          setSyncStatus('Cached graph · refresh to reconnect folder');
          return;
        }
        await reconcileFolder(restoredRoot, restoredPages);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (active) showNotice('Could not restore the cached graph. Open its folder to reconnect.');
      }
    })();
    return () => {
      active = false;
      reconciliationAbort.current?.abort();
      void cachePromise.current?.then((cache) => cache.close());
    };
  }, [getCache, reconcileFolder, replaceBlockIndex, replacePages, showNotice]);

  useEffect(() => {
    const reconcileWhenStale = (): void => {
      if (
        document.visibilityState !== 'visible' ||
        !root ||
        !hasFolderPermission ||
        reconciliationAbort.current ||
        Date.now() - lastReconciledAt.current < reconciliationStaleAfterMs
      ) {
        return;
      }
      void reconcileFolder(root, pagesRef.current).catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          showNotice('Could not check the graph for external changes.');
        }
      });
    };
    document.addEventListener('visibilitychange', reconcileWhenStale);
    window.addEventListener('focus', reconcileWhenStale);
    return () => {
      document.removeEventListener('visibilitychange', reconcileWhenStale);
      window.removeEventListener('focus', reconcileWhenStale);
    };
  }, [hasFolderPermission, reconcileFolder, root, showNotice]);

  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        openCommandPalette();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'n') {
        event.preventDefault();
        launchNewPage();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [launchNewPage, openCommandPalette]);

  useEffect(() => {
    if (!isCommandPaletteOpen) return;
    window.requestAnimationFrame(() => commandInput.current?.focus());
  }, [isCommandPaletteOpen]);

  useEffect(() => {
    if (!isCreatePageOpen) return;
    window.requestAnimationFrame(() => createPageInput.current?.focus());
  }, [isCreatePageOpen]);

  useEffect(() => {
    if (!isEditing || isDemo || !selectedPage?.handle || draft === selectedPage.content) return;
    const page = selectedPage;
    const content = draft;
    const timeout = window.setTimeout(async () => {
      setIsSaving(true);
      try {
        await savePage(page, content, page.content);
        await applySavedPage(page, content);
        localStorage.removeItem(`loam:draft:${page.path}`);
      } catch (error) {
        localStorage.setItem(`loam:draft:${page.path}`, content);
        showNotice(error instanceof Error ? error.message : 'Could not autosave this page.');
      } finally {
        setIsSaving(false);
      }
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [applySavedPage, draft, isDemo, isEditing, selectedPage, showNotice]);

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Folder switching deliberately keeps picker, cache identity, journal creation, and UI handoff atomic.
  const openFolder = async () => {
    setIsLoading(true);
    try {
      const handle = await pickLogseqFolder();
      const cache = await getCache();
      const snapshot = await loadRecoverableSnapshot(cache);
      const sameGraph = await isSameDirectory(snapshot.graph?.rootHandle, handle);
      if (!sameGraph) await cache.clearGraph(activeGraphId);
      const previous = sameGraph ? cachedPagesToLocal(snapshot.pages, snapshot.edges) : [];
      setRoot(handle);
      setHasFolderPermission(true);
      let loadedPages = await reconcileFolder(handle, previous, !sameGraph);
      if (!findJournalByDate(loadedPages)) {
        await ensureJournalFile(handle);
        loadedPages = await reconcileFolder(handle, loadedPages);
      }
      setFocusedBlockId(undefined);
      setSelectedTitle((findJournalByDate(loadedPages) ?? loadedPages[0])?.title ?? '');
      setIsDemo(false);
      setIsEditing(false);
      showNotice(`${loadedPages.length} pages connected from your local graph.`);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      showNotice(error instanceof Error ? error.message : 'Could not open that folder.');
    } finally {
      setIsLoading(false);
    }
  };

  const refreshFolder = async () => {
    if (!root) return openFolder();
    setIsLoading(true);
    try {
      if (!(await requestFolderPermission(root))) {
        setHasFolderPermission(false);
        showNotice('Folder access is needed to refresh this graph.');
        return;
      }
      setHasFolderPermission(true);
      const loadedPages = await reconcileFolder(root, pagesRef.current, true);
      setFocusedBlockId(undefined);
      setSelectedTitle((current) =>
        loadedPages.some((page) => page.title === current) ? current : (loadedPages[0]?.title ?? '')
      );
      showNotice('Graph refreshed and its cache rebuilt from disk.');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        showNotice(error instanceof Error ? error.message : 'Could not refresh the graph.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const selectPage = (title: string, blockId?: string) => {
    setSelectedTitle(title);
    setFocusedBlockId(blockId);
    setIsEditing(false);
    setViewMode('page');
  };

  const openTag = (tag: string) => {
    setActiveTag(tag.trim().toLocaleLowerCase());
    setViewMode('tags');
    setIsEditing(false);
    setFocusedBlockId(undefined);
  };

  const openBlock = (result: BlockSearchResult) => {
    const page = pages.find((candidate) => candidate.path === result.pagePath);
    if (!page) return;
    const target = createBlockNavigationTarget(page, result.blockId, search);
    setSearchHistory((current) => rememberSearchQuery(current, target.query));
    selectPage(target.pageTitle, target.blockId);
  };

  const openToday = async () => {
    const existing = findJournalByDate(pages);
    if (existing) {
      selectPage(existing.title);
      return;
    }
    if (!root) return;

    setIsLoading(true);
    try {
      if (!(await ensureFolderAccess(root))) return;
      await ensureJournalFile(root);
      const loadedPages = await reconcileFolder(root, pagesRef.current);
      const today = findJournalByDate(loadedPages);
      if (today) selectPage(today.title);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Could not open today’s journal.');
    } finally {
      setIsLoading(false);
    }
  };

  const navigateJournal = (direction: -1 | 1) => {
    const journal = journalPages[selectedJournalIndex + direction];
    if (journal) selectPage(journal.title);
  };

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Link activation coordinates existing navigation, demo creation, journal creation, and local-folder reconciliation.
  const openLink = async (target: string) => {
    const title = target.trim();
    if (!title) return;
    const date = dateFromPageTitle(title);
    const linkedPage =
      (date ? findJournalByDate(pages, date) : undefined) ??
      pages.find((page) => normalizePageTitle(page.title) === normalizePageTitle(title));
    if (linkedPage) {
      selectPage(linkedPage.title);
      return;
    }

    if (isDemo) {
      const createdTitle = date ? journalTitleForDate(date) : title;
      const inputs: PageInput[] = [
        ...pagesRef.current.map((page) => ({
          content: page.content,
          path: page.path,
          title: page.title,
        })),
        {
          content: '- ',
          path: date ? journalPathForDate(date) : `pages/${pageFilenameForTitle(title)}`,
          title: createdTitle,
        },
      ];
      const next = buildPageIndex(inputs);
      replacePages(next);
      replaceBlockIndex(indexPageBlocks(next));
      selectPage(createdTitle);
      showNotice(`Created “${title}” in the demo graph.`);
      return;
    }

    if (!root) {
      showNotice('Reconnect the local graph before creating this linked page.');
      return;
    }

    setIsLoading(true);
    try {
      if (!(await ensureFolderAccess(root))) return;
      if (date) await ensureJournalFile(root, date);
      else await createPageFile(root, title);
      const loadedPages = await reconcileFolder(root, pagesRef.current);
      const created = loadedPages.find(
        (page) => normalizePageTitle(page.title) === normalizePageTitle(title)
      );
      if (created) selectPage(created.title);
      showNotice(`Created “${title}” from its page link.`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Could not create the linked page.');
    } finally {
      setIsLoading(false);
    }
  };

  const startEditing = () => {
    if (!selectedPage) return;
    if (!isDemo && !hasFolderPermission) {
      showNotice('Refresh the graph to reconnect its folder before editing.');
      return;
    }
    const recovered = localStorage.getItem(`loam:draft:${selectedPage.path}`);
    const content = recovered ?? selectedPage.content;
    const document = splitFrontmatter(content);
    setDraft(content);
    setEditorFrontmatter(document.source ?? '');
    setEditorFinalNewline(document.body.endsWith('\n'));
    const safety = assessOutlinerSafety(content);
    setEditorKind(safety.safe ? 'outliner' : 'raw');
    setEditorBlocks(parseMarkdownBlocks(content, selectedPage.path, selectedPage.title));
    setIsEditing(true);
    if (recovered) showNotice('Recovered an unsaved local draft.');
  };

  const saveDraft = async () => {
    if (!selectedPage) return;
    setIsSaving(true);
    try {
      if (!isDemo) await savePage(selectedPage, draft, selectedPage.content);
      await applySavedPage(selectedPage, draft);
      setIsEditing(false);
      localStorage.removeItem(`loam:draft:${selectedPage.path}`);
      showNotice(
        isDemo ? 'Demo changes are kept until you reload.' : 'Saved to your local folder.'
      );
    } catch (error) {
      localStorage.setItem(`loam:draft:${selectedPage.path}`, draft);
      showNotice(error instanceof Error ? error.message : 'Could not save this page.');
    } finally {
      setIsSaving(false);
    }
  };

  const updateEditor = (blocks: OutlinerBlock[]) => {
    const content = serializeMarkdownBlocks(blocks, editorFinalNewline, editorFrontmatter);
    setEditorBlocks(blocks);
    setDraft(content);
    if (selectedPage) localStorage.setItem(`loam:draft:${selectedPage.path}`, content);
  };

  const updateRawEditor = (content: string) => {
    setDraft(content);
    if (selectedPage) localStorage.setItem(`loam:draft:${selectedPage.path}`, content);
  };

  const pasteIntoRawEditor = (event: ClipboardEvent) => {
    if (!event.clipboardData || !selectedPage) return;
    const html = event.clipboardData.getData('text/html');
    if (!html) return;
    const markdown = markdownFromClipboard({
      html,
      text: event.clipboardData.getData('text/plain'),
    });
    if (!markdown) return;

    event.preventDefault();
    const input = event.currentTarget as HTMLTextAreaElement;
    const start = input.selectionStart ?? draft.length;
    const end = input.selectionEnd ?? start;
    const content = `${draft.slice(0, start)}${markdown}${draft.slice(end)}`;
    const caret = start + markdown.length;
    updateRawEditor(content);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(caret, caret);
    });
  };

  const handleCreatePage = async (event: Event) => {
    event.preventDefault();
    const title = newPageTitle.trim();
    if (!root || !title) return;
    try {
      if (!(await ensureFolderAccess(root))) return;
      await createPageFile(root, title);
      const loadedPages = await reconcileFolder(root, pagesRef.current);
      const created = loadedPages.find(
        (page) => normalizePageTitle(page.title) === normalizePageTitle(title)
      );
      if (created) selectPage(created.title);
      setNewPageTitle('');
      setIsCreatePageOpen(false);
      showNotice(`Created “${title}”.`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Could not create the page.');
    }
  };

  const handleCapture = async (event: Event) => {
    event.preventDefault();
    if (!root || !captureText.trim()) return;
    const captured = captureText.trim();
    setCaptureText('');
    try {
      if (!(await ensureFolderAccess(root))) {
        setCaptureText(captured);
        return;
      }
      await appendJournalCapture(root, captured);
      const loadedPages = await reconcileFolder(root, pagesRef.current);
      const today = findJournalByDate(loadedPages);
      if (today) selectPage(today.title);
      showNotice('Captured in today’s journal.');
    } catch (error) {
      setCaptureText(captured);
      showNotice(error instanceof Error ? error.message : 'Could not capture this block.');
    }
  };

  const commandQuery = paletteQuery.trim().toLocaleLowerCase();
  const commands: PaletteCommand[] = [
    ...(paletteQuery.trim()
      ? [
          {
            description: root ? 'Create it in your local graph' : 'Open a local graph first',
            icon: 'plus' as const,
            id: 'create-page-named',
            label: `Create page “${paletteQuery.trim()}”`,
            run: () => launchNewPage(paletteQuery.trim()),
          },
        ]
      : []),
    {
      description: root ? 'Start a blank page in pages/' : 'Open a local graph first',
      icon: 'plus' as const,
      id: 'new-page',
      label: 'New page',
      run: () => launchNewPage(),
      shortcut: '⌘ N',
    },
    {
      description: 'Find pages and blocks in this graph',
      icon: 'search' as const,
      id: 'search',
      label: 'Search pages and blocks',
      run: () => {
        closeCommandPalette();
        window.setTimeout(() => searchInput.current?.focus(), 0);
      },
    },
    {
      description: 'Browse tags across every page',
      icon: 'tag' as const,
      id: 'tags',
      label: 'Open tags view',
      run: () => {
        closeCommandPalette();
        setActiveTag('');
        setViewMode('tags');
      },
    },
    {
      description: 'Open today’s journal',
      icon: 'spark' as const,
      id: 'today',
      label: 'Go to Today',
      run: () => {
        closeCommandPalette();
        return openToday();
      },
    },
    {
      description: root ? 'Read the latest files from disk' : 'Choose a local graph folder',
      icon: 'refresh' as const,
      id: 'refresh',
      label: root ? 'Refresh graph' : 'Open a Logseq folder',
      run: () => {
        closeCommandPalette();
        return root ? refreshFolder() : openFolder();
      },
    },
  ];
  const filteredCommands = filterCommandPaletteItems(commands, commandQuery);

  const runPaletteCommand = (command: PaletteCommand | undefined) => {
    if (!command) return;
    void command.run();
  };

  return (
    <div className='app-shell'>
      <header className='topbar'>
        <div className='brand-lockup'>
          <div className='brand-mark'>
            <span />
          </div>
          <div>
            <p className='brand-name'>loam</p>
            <p className='brand-tagline'>a softer graph reader</p>
          </div>
        </div>
        <div className='topbar-actions'>
          <button
            aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}
            className='button button-quiet theme-toggle'
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            title={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}
            type='button'
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
            <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
          <button
            aria-label='Open command palette'
            aria-keyshortcuts='Meta+K Control+K'
            className='command-trigger'
            onClick={openCommandPalette}
            type='button'
          >
            <Icon name='search' size={15} />
            <span>Command palette</span>
            <kbd>⌘ K</kbd>
          </button>
          <div className={`connection-status ${isDemo ? 'status-demo' : ''}`}>
            <span className='status-dot' />
            {isDemo ? 'Demo graph' : 'Local graph connected'}
          </div>
          <button
            className='button button-quiet'
            disabled={isLoading}
            onClick={openFolder}
            type='button'
          >
            <Icon name='folder' size={16} />
            {isLoading ? 'Opening…' : isDemo ? 'Open folder' : 'Switch folder'}
          </button>
        </div>
      </header>

      <div className='app-layout'>
        <aside className='sidebar'>
          <div className='sidebar-intro'>
            <div className='graph-avatar'>
              <Icon name='book' size={19} />
            </div>
            <div>
              <p className='sidebar-label'>CURRENT GRAPH</p>
              <p className='graph-name'>
                {isDemo ? 'A little starting point' : 'Local Logseq graph'}
              </p>
            </div>
          </div>

          <div className='search-box'>
            <Icon name='search' size={16} />
            <input
              aria-label='Search pages'
              aria-keyshortcuts='Meta+K Control+K'
              list='search-history'
              onInput={(event) => {
                const value = event.currentTarget.value;
                setSearch(value);
                setSearchHistory((current) => rememberSearchQuery(current, value));
              }}
              placeholder='Search blocks and pages…'
              ref={searchInput}
              type='search'
              value={search}
            />
            <kbd>⌘ K</kbd>
            <datalist id='search-history'>
              {searchHistory.map((query) => (
                <option key={query} value={query} />
              ))}
            </datalist>
          </div>

          <button className='today-button' onClick={openToday} type='button'>
            <span className='page-nav-icon'>
              <Icon name='spark' size={15} />
            </span>
            <span>Today</span>
            <span className='today-date'>{journalTitleForDate()}</span>
          </button>

          <button
            className={`sidebar-view-button ${viewMode === 'tags' ? 'sidebar-view-button-active' : ''}`}
            onClick={() => {
              setActiveTag('');
              setViewMode('tags');
              setIsEditing(false);
            }}
            type='button'
          >
            <span className='page-nav-icon'>
              <Icon name='tag' size={15} />
            </span>
            <span>Tags</span>
            <span className='count-pill'>{tagSummaries.length}</span>
          </button>

          <div className='sidebar-section-heading'>
            <span>Pages</span>
            <span className='count-pill'>{filteredPages.length}</span>
          </div>
          <nav className='page-list' aria-label='Pages'>
            {hierarchyRows.map((node) =>
              node.page ? (
                <button
                  aria-current={node.page.title === selectedPage?.title ? 'page' : undefined}
                  className={`page-nav-item ${node.page.title === selectedPage?.title && viewMode === 'page' ? 'page-nav-active' : ''}`}
                  key={node.page.path}
                  onClick={() => selectPage(node.page?.title ?? '')}
                  style={{ paddingLeft: `${10 + node.depth * 13}px` }}
                  type='button'
                >
                  {node.depth > 0 && <span aria-hidden='true' className='page-nav-branch' />}
                  <span className='page-nav-icon'>
                    <Icon name='book' size={15} />
                  </span>
                  <span className='page-nav-title page-nav-leaf'>{node.breadcrumbs.at(-1)}</span>
                  {(pages.find((page) => page.path === node.page?.path)?.backlinks.length ?? 0) >
                    0 && (
                    <span className='page-nav-count'>
                      {pages.find((page) => page.path === node.page?.path)?.backlinks.length}
                    </span>
                  )}
                </button>
              ) : (
                <div
                  className='page-nav-item page-nav-synthetic'
                  key={`group-${node.title}`}
                  style={{ paddingLeft: `${10 + node.depth * 13}px` }}
                >
                  {node.depth > 0 && <span aria-hidden='true' className='page-nav-branch' />}
                  <span className='page-nav-icon'>
                    <Icon name='chevron' size={13} />
                  </span>
                  <span className='page-nav-title page-nav-parent'>{node.breadcrumbs.at(-1)}</span>
                </div>
              )
            )}
            {!filteredPages.length && !blockSearchResults.length && (
              <p className='no-results'>No blocks or pages match “{search}”.</p>
            )}
          </nav>

          {blockSearchResults.length > 0 && (
            <section className='block-results' aria-label='Matching blocks'>
              <div className='sidebar-section-heading'>
                <span>Matching blocks</span>
                <span className='count-pill'>{blockSearchResults.length}</span>
              </div>
              {blockSearchResults.map((result) => (
                <button
                  className='block-result'
                  key={`${result.pagePath}-${result.blockId}`}
                  onClick={() => openBlock(result)}
                  title={`Open ${result.pageTitle} at this block`}
                  type='button'
                >
                  <span className='block-result-page'>{result.pageTitle}</span>
                  {result.context && <span className='block-result-context'>{result.context}</span>}
                  <span className='block-result-content'>{result.content}</span>
                </button>
              ))}
            </section>
          )}

          <div className='sidebar-bottom'>
            <div className='folder-tip'>
              <Icon name='spark' size={16} />
              <span>
                {isDemo
                  ? 'Your graph stays local.'
                  : syncStatus || `${pages.length} markdown pages indexed.`}
              </span>
            </div>
            <button
              className='button button-quiet sidebar-refresh'
              disabled={isLoading}
              onClick={refreshFolder}
              type='button'
            >
              <Icon name='refresh' size={15} /> Refresh from disk
            </button>
            {root && (
              <form className='new-page-form' onSubmit={handleCreatePage}>
                <input
                  aria-label='Create a new page'
                  onInput={(event) => setNewPageTitle(event.currentTarget.value)}
                  placeholder='New page title…'
                  value={newPageTitle}
                />
                <button aria-label='Create page' type='submit'>
                  <Icon name='plus' size={15} />
                </button>
              </form>
            )}
          </div>
        </aside>

        <main className='content-area'>
          {viewMode === 'tags' ? (
            <TagsView
              activeTag={activeTag}
              onOpenPage={selectPage}
              onSelectTag={setActiveTag}
              pages={pages}
              summaries={tagSummaries}
            />
          ) : selectedPage ? (
            <>
              <div className='page-toolbar'>
                <div className='breadcrumbs'>
                  <span>Pages</span>
                  {selectedBreadcrumbs.map((part, index) => {
                    const title = selectedBreadcrumbs.slice(0, index + 1).join('/');
                    const page = pages.find(
                      (candidate) =>
                        normalizePageTitle(candidate.title) === normalizePageTitle(title)
                    );
                    return (
                      <span className='breadcrumb-part' key={title}>
                        <Icon name='chevron' size={14} />
                        {page && index < selectedBreadcrumbs.length - 1 ? (
                          <button onClick={() => selectPage(page.title)} type='button'>
                            {part}
                          </button>
                        ) : (
                          <span>{part}</span>
                        )}
                      </span>
                    );
                  })}
                </div>
                {focusedBlockId && !isEditing && (
                  <button
                    className='focus-exit-button'
                    onClick={() => setFocusedBlockId(undefined)}
                    type='button'
                  >
                    Focused block · Exit
                  </button>
                )}
                <div className='page-actions'>
                  {selectedJournalIndex >= 0 && !isEditing && (
                    <fieldset className='journal-navigation'>
                      <legend className='sr-only'>Journal navigation</legend>
                      <button
                        aria-label='Previous journal'
                        disabled={selectedJournalIndex === 0}
                        onClick={() => navigateJournal(-1)}
                        type='button'
                      >
                        ‹
                      </button>
                      <button
                        aria-label='Next journal'
                        disabled={selectedJournalIndex === journalPages.length - 1}
                        onClick={() => navigateJournal(1)}
                        type='button'
                      >
                        ›
                      </button>
                    </fieldset>
                  )}
                  {isEditing ? (
                    <button
                      className='button button-primary save-button'
                      disabled={isSaving}
                      onClick={saveDraft}
                      type='button'
                    >
                      <Icon name='check' size={16} />
                      {isSaving ? 'Saving…' : isDemo ? 'Keep demo edit' : 'Done'}
                    </button>
                  ) : (
                    <button className='button button-quiet' onClick={startEditing} type='button'>
                      <Icon name='edit' size={16} /> Edit page
                    </button>
                  )}
                </div>
              </div>

              <article className='page-card'>
                <div className='page-heading'>
                  <div>
                    <p className='page-kicker'>{isDemo ? 'STARTER NOTE' : selectedPage.path}</p>
                    <h1>{selectedPage.title}</h1>
                  </div>
                  <div className='page-stats'>
                    <span>
                      <Icon name='link' size={14} /> {selectedPage.links.length} links
                    </span>
                    <span>
                      <Icon name='arrow' size={14} /> {selectedBacklinks.length} backlinks
                    </span>
                  </div>
                </div>
                {isEditing ? (
                  editorKind === 'raw' ? (
                    <div className='raw-editor-wrap'>
                      <div className='raw-editor-heading'>
                        <p className='editor-mode-label'>
                          Raw Markdown fallback · source preserved exactly
                        </p>
                        <p className='editor-mode-reason'>
                          {assessOutlinerSafety(draft).reasons.join(', ')}
                        </p>
                      </div>
                      <textarea
                        aria-label={`Raw Markdown for ${selectedPage.title}`}
                        className='page-editor'
                        onInput={(event) => {
                          updateRawEditor(event.currentTarget.value);
                        }}
                        onPaste={pasteIntoRawEditor}
                        value={draft}
                        spellcheck={false}
                      />
                    </div>
                  ) : (
                    <OutlinerEditor
                      ariaLabel={`Edit ${selectedPage.title}`}
                      blocks={editorBlocks}
                      className='page-outliner'
                      focusedBlockId={focusedBlockId}
                      onChange={updateEditor}
                      onExitFocus={() => setFocusedBlockId(undefined)}
                    />
                  )
                ) : (
                  <MarkdownBody
                    focusedBlockId={focusedBlockId}
                    markdown={selectedPage.content}
                    onLink={openLink}
                    onTag={openTag}
                    pagePath={selectedPage.path}
                    pageTitle={selectedPage.title}
                    root={root}
                  />
                )}
                {!isEditing && (
                  <section className='connections-overview' aria-label='Page connections'>
                    <div className='connections-overview-heading'>
                      <div>
                        <p className='eyebrow'>CONNECTIONS</p>
                        <h2>Follow this page through the graph</h2>
                      </div>
                      <span>
                        {selectedPage.links.length + selectedBacklinks.length} visible connections
                      </span>
                    </div>
                    <div className='connection-columns'>
                      <div>
                        <p className='connection-column-title'>Linked from this page</p>
                        <div className='connection-chips'>
                          {selectedPage.links.slice(0, 8).map((link) => (
                            <button
                              key={`${link.target}-${link.label}`}
                              onClick={() => openLink(link.target)}
                              type='button'
                            >
                              <Icon name='link' size={13} />
                              {link.label}
                            </button>
                          ))}
                          {!selectedPage.links.length && <span>No outgoing page links yet.</span>}
                        </div>
                      </div>
                      <div>
                        <p className='connection-column-title'>Pages linking here</p>
                        <div className='connection-chips'>
                          {selectedBacklinks.slice(0, 8).map((backlink) => (
                            <button
                              key={`${backlink.pagePath}-${backlink.blockId}`}
                              onClick={() => openBlock(backlink)}
                              title={backlink.content}
                              type='button'
                            >
                              <Icon name='arrow' size={13} />
                              {backlink.pageTitle}
                            </button>
                          ))}
                          {!selectedBacklinks.length && <span>No backlinks yet.</span>}
                        </div>
                      </div>
                    </div>
                  </section>
                )}
              </article>
              <p className='privacy-line'>
                <span className='privacy-lock'>✦</span> Your notes are read directly from the folder
                you choose. Nothing is uploaded.
              </p>
            </>
          ) : (
            <EmptyState onOpen={openFolder} supported={supported} />
          )}
        </main>

        <aside className='inspector'>
          {viewMode === 'tags' ? (
            <>
              <div className='inspector-header'>
                <p className='eyebrow'>TAG MAP</p>
                <span className='inspector-dot' />
              </div>
              <section className='relation-card'>
                <div className='relation-heading'>
                  <span className='relation-icon relation-icon-cool'>
                    <Icon name='tag' size={16} />
                  </span>
                  <div>
                    <p className='relation-title'>Tags</p>
                    <p className='relation-subtitle'>Topics across this graph</p>
                  </div>
                  <span className='relation-count'>{tagSummaries.length}</span>
                </div>
                {tagSummaries.length ? (
                  <div className='relation-list'>
                    {tagSummaries.slice(0, 20).map((summary) => (
                      <button
                        aria-current={summary.tag === activeTag ? 'true' : undefined}
                        key={summary.tag}
                        onClick={() => openTag(summary.tag)}
                        type='button'
                      >
                        <span className='relation-bullet' />@{summary.tag}
                        <span className='relation-count'>{summary.pageCount}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className='relation-empty'>No tags have been indexed yet.</p>
                )}
              </section>
            </>
          ) : selectedPage ? (
            <>
              <div className='inspector-header'>
                <p className='eyebrow'>PAGE MAP</p>
                <span className='inspector-dot' />
              </div>
              <section className='relation-card'>
                <div className='relation-heading'>
                  <span className='relation-icon relation-icon-warm'>
                    <Icon name='arrow' size={16} />
                  </span>
                  <div>
                    <p className='relation-title'>Backlinks</p>
                    <p className='relation-subtitle'>Pages pointing here</p>
                  </div>
                  <span className='relation-count'>{selectedBacklinks.length}</span>
                </div>
                {selectedBacklinks.length ? (
                  <div className='relation-list'>
                    {selectedBacklinks.map((backlink) => (
                      <button
                        key={`${backlink.pagePath}-${backlink.blockId}`}
                        onClick={() => openBlock(backlink)}
                        title={backlink.content}
                        type='button'
                      >
                        <span className='relation-bullet' />
                        <span className='relation-backlink-copy'>
                          <strong>{backlink.pageTitle}</strong>
                          <small>{backlink.content}</small>
                        </span>
                        <Icon name='chevron' size={14} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className='relation-empty'>No pages link here yet.</p>
                )}
              </section>
              <section className='relation-card'>
                <div className='relation-heading'>
                  <span className='relation-icon relation-icon-cool'>
                    <Icon name='link' size={16} />
                  </span>
                  <div>
                    <p className='relation-title'>Linked pages</p>
                    <p className='relation-subtitle'>References in this page</p>
                  </div>
                  <span className='relation-count'>{selectedPage.links.length}</span>
                </div>
                {selectedPage.links.length ? (
                  <div className='relation-list'>
                    {selectedPage.links.map((link) => {
                      const exists = pages.some(
                        (page) => normalizePageTitle(page.title) === normalizePageTitle(link.target)
                      );
                      return (
                        <button
                          className={exists ? '' : 'relation-missing'}
                          key={`${link.target}-${link.label}`}
                          onClick={() => openLink(link.target)}
                          type='button'
                        >
                          <span className='relation-bullet' />
                          {link.label}
                          <Icon name={exists ? 'chevron' : 'plus'} size={14} />
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className='relation-empty'>Add [[page links]] while editing.</p>
                )}
              </section>
              <div className='inspector-tip'>
                <Icon name='spark' size={17} />
                <p>
                  <strong>Small graph, big feeling.</strong>
                  <br />
                  Follow a link to move through your notes without losing the thread.
                </p>
              </div>
            </>
          ) : (
            <EmptyState onOpen={openFolder} supported={supported} />
          )}
        </aside>
      </div>

      {root && !isEditing && (
        <form className='quick-create' onSubmit={handleCapture}>
          <Icon name='plus' size={17} />
          <input
            aria-label='Quick capture to today’s journal'
            enterkeyhint='send'
            onInput={(event) => setCaptureText(event.currentTarget.value)}
            placeholder='Capture to today…'
            value={captureText}
          />
          <button aria-label='Capture block' type='submit'>
            <Icon name='arrow' size={16} />
          </button>
        </form>
      )}
      {isCommandPaletteOpen && (
        <div className='overlay' role='presentation'>
          <section
            aria-label='Command palette'
            aria-modal='true'
            className='command-palette'
            onMouseDown={(event) => event.stopPropagation()}
            role='dialog'
          >
            <div className='command-search'>
              <Icon name='search' size={18} />
              <input
                aria-label='Search commands'
                onInput={(event) => {
                  setPaletteQuery(event.currentTarget.value);
                  setPaletteSelection(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setPaletteSelection((current) =>
                      filteredCommands.length ? (current + 1) % filteredCommands.length : 0
                    );
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setPaletteSelection((current) =>
                      filteredCommands.length
                        ? (current - 1 + filteredCommands.length) % filteredCommands.length
                        : 0
                    );
                  } else if (event.key === 'Enter') {
                    event.preventDefault();
                    runPaletteCommand(filteredCommands[paletteSelection] ?? filteredCommands[0]);
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    closeCommandPalette();
                  }
                }}
                placeholder='Type a command…'
                ref={commandInput}
                value={paletteQuery}
              />
              <kbd>ESC</kbd>
            </div>
            <div className='command-list' role='listbox' aria-label='Available commands'>
              {filteredCommands.length ? (
                filteredCommands.map((command, index) => (
                  <button
                    aria-selected={index === paletteSelection}
                    className={`command-item ${index === paletteSelection ? 'command-item-active' : ''}`}
                    key={command.id}
                    onClick={() => runPaletteCommand(command)}
                    onMouseEnter={() => setPaletteSelection(index)}
                    role='option'
                    type='button'
                  >
                    <span className='command-item-icon'>
                      <Icon name={command.icon} size={16} />
                    </span>
                    <span className='command-item-copy'>
                      <strong>{command.label}</strong>
                      <small>{command.description}</small>
                    </span>
                    {command.shortcut && <kbd>{command.shortcut}</kbd>}
                  </button>
                ))
              ) : (
                <p className='command-empty'>No commands match “{paletteQuery}”.</p>
              )}
            </div>
            <div className='command-footer'>
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> Navigate
              </span>
              <span>
                <kbd>↵</kbd> Select
              </span>
              <span>
                <kbd>ESC</kbd> Close
              </span>
            </div>
          </section>
        </div>
      )}
      {isCreatePageOpen && (
        <div className='overlay' role='presentation'>
          <section
            aria-labelledby='create-page-title'
            aria-modal='true'
            className='create-page-dialog'
            onMouseDown={(event) => event.stopPropagation()}
            role='dialog'
          >
            <div className='dialog-heading'>
              <div className='command-item-icon'>
                <Icon name='plus' size={17} />
              </div>
              <div>
                <p className='eyebrow'>NEW PAGE</p>
                <h2 id='create-page-title'>What should this page be called?</h2>
              </div>
              <button
                aria-label='Close new page dialog'
                className='dialog-close'
                onClick={() => setIsCreatePageOpen(false)}
                type='button'
              >
                <Icon name='close' size={17} />
              </button>
            </div>
            <form onSubmit={handleCreatePage}>
              <label className='sr-only' htmlFor='new-page-title'>
                Page title
              </label>
              <input
                autoComplete='off'
                className='create-page-input'
                id='new-page-title'
                onInput={(event) => setNewPageTitle(event.currentTarget.value)}
                placeholder='e.g. Ideas for the next season'
                ref={createPageInput}
                value={newPageTitle}
              />
              <p className='dialog-hint'>
                Saved as a Markdown page in your <code>pages/</code> folder.
              </p>
              <div className='dialog-actions'>
                <button
                  className='button button-quiet'
                  onClick={() => setIsCreatePageOpen(false)}
                  type='button'
                >
                  Cancel
                </button>
                <button
                  className='button button-primary'
                  disabled={!newPageTitle.trim()}
                  type='submit'
                >
                  <Icon name='plus' size={16} /> Create page
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {notice && (
        <div className='toast' role='status'>
          <span className='toast-mark'>
            <Icon name='check' size={14} />
          </span>
          {notice}
          <button aria-label='Dismiss notification' onClick={() => setNotice('')} type='button'>
            <Icon name='close' size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
