import { buildPageIndex, flattenBlockTree, normalizePageTitle, type PageInput } from '@loam/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  appendJournalCapture,
  createPageFile,
  ensureJournalFile,
  findJournalByDate,
  journalPathForDate,
  journalTitleForDate,
  type LocalPage,
  pickLogseqFolder,
  readLogseqFolder,
  savePage,
  supportsFolderAccess,
} from './logseq.js';
import { MarkdownBody } from './MarkdownBody.js';
import { createBlockNavigationTarget, rememberSearchQuery } from './navigation-model.js';
import { OutlinerEditor } from './OutlinerEditor.js';
import {
  assessOutlinerSafety,
  type OutlinerBlock,
  parseMarkdownBlocks,
  serializeMarkdownBlocks,
} from './outliner-model.js';
import './styles.css';

const todayTitle = journalTitleForDate();

const demoPages: PageInput[] = [
  {
    title: todayTitle,
    path: journalPathForDate(),
    content:
      '- Welcome to your daily journal\n  - Press Enter to create a block\n  - Press Tab to nest it beneath the previous thought\n- Try the editor, then open your local graph when you are ready.\n',
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
      '- TODO Sketch the first release\n  - DONE Set up local folder access\n  - TODO Link the page view to [[Reading list]]\n- The best next step is usually the one that makes the graph feel more alive.\n  - See [[Welcome to Loam]] for the short tour.\n',
  },
  {
    title: 'Reading list',
    path: 'pages/Reading_list.md',
    content:
      '- [[The Art of Noticing]] — a reminder to look slowly\n- [[Designing for calm]] — notes on humane interfaces\n- #someday\n  - This page is linked from [[Working set]].\n  - Unknown links remain visible and ready to become pages.\n',
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

type IconName =
  | 'arrow'
  | 'book'
  | 'check'
  | 'chevron'
  | 'close'
  | 'edit'
  | 'folder'
  | 'link'
  | 'plus'
  | 'refresh'
  | 'search'
  | 'spark';

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
  }
}

function reindexPages(pages: LocalPage[]): LocalPage[] {
  const handles = new Map(pages.map((page) => [page.path, page.handle]));
  return buildPageIndex(pages.map(({ title, path, content }) => ({ title, path, content }))).map(
    (page) => ({
      ...page,
      handle: handles.get(page.path),
    })
  );
}

interface BlockSearchResult {
  blockId: string;
  content: string;
  context?: string;
  pagePath: string;
  pageTitle: string;
  references: string[];
  searchable: string;
}

function indexPageBlocks(pages: LocalPage[]): BlockSearchResult[] {
  const results: BlockSearchResult[] = [];
  for (const page of pages) {
    const blocks = flattenBlockTree(parseMarkdownBlocks(page.content, page.path, page.title));
    const byId = new Map(blocks.map((block) => [block.id, block]));
    for (const block of blocks) {
      const searchable = [
        page.title,
        block.content,
        ...block.references,
        ...block.tags,
        ...Object.entries(block.properties).flat(),
      ]
        .join(' ')
        .toLocaleLowerCase();
      const parent = block.parentId ? byId.get(block.parentId) : undefined;
      results.push({
        blockId: block.id,
        content: block.content.split('\n')[0] || 'Empty block',
        context: parent?.content.split('\n')[0],
        pagePath: page.path,
        pageTitle: page.title,
        references: block.references,
        searchable,
      });
    }
  }
  return results;
}

function searchPageBlocks(index: BlockSearchResult[], search: string): BlockSearchResult[] {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return [];
  return index.filter((result) => result.searchable.includes(query)).slice(0, 40);
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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The app shell intentionally keeps the local graph workflow in one place.
export function App() {
  const [root, setRoot] = useState<FileSystemDirectoryHandle>();
  const [pages, setPages] = useState<LocalPage[]>(demoIndex);
  const [selectedTitle, setSelectedTitle] = useState(todayTitle);
  const [search, setSearch] = useState('');
  const [isDemo, setIsDemo] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [editorBlocks, setEditorBlocks] = useState<OutlinerBlock[]>([]);
  const [editorKind, setEditorKind] = useState<'outliner' | 'raw'>('outliner');
  const [editorFinalNewline, setEditorFinalNewline] = useState(false);
  const [focusedBlockId, setFocusedBlockId] = useState<string>();
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [newPageTitle, setNewPageTitle] = useState('');
  const [captureText, setCaptureText] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);

  const selectedPage = pages.find((page) => page.title === selectedTitle) ?? pages[0];
  const filteredPages = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return pages;
    return pages.filter((page) => `${page.title} ${page.path}`.toLocaleLowerCase().includes(query));
  }, [pages, search]);
  const blockIndex = useMemo(() => indexPageBlocks(pages), [pages]);
  const blockSearchResults = useMemo(
    () => searchPageBlocks(blockIndex, search),
    [blockIndex, search]
  );
  const selectedBacklinks = useMemo(() => {
    if (!selectedPage) return [];
    const target = normalizePageTitle(selectedPage.title);
    return blockIndex
      .filter((result) =>
        result.references.some((reference) => normalizePageTitle(reference) === target)
      )
      .slice(0, 30);
  }, [blockIndex, selectedPage]);
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
  const supported = supportsFolderAccess();
  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 4200);
  }, []);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  useEffect(() => {
    if (!isEditing || isDemo || !selectedPage?.handle || draft === selectedPage.content) return;
    const page = selectedPage;
    const content = draft;
    const timeout = window.setTimeout(async () => {
      setIsSaving(true);
      try {
        await savePage(page, content, page.content);
        setPages((current) =>
          reindexPages(
            current.map((candidate) =>
              candidate.path === page.path ? { ...candidate, content } : candidate
            )
          )
        );
        localStorage.removeItem(`loam:draft:${page.path}`);
      } catch (error) {
        localStorage.setItem(`loam:draft:${page.path}`, content);
        showNotice(error instanceof Error ? error.message : 'Could not autosave this page.');
      } finally {
        setIsSaving(false);
      }
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [draft, isDemo, isEditing, selectedPage, showNotice]);

  const openFolder = async () => {
    setIsLoading(true);
    try {
      const handle = await pickLogseqFolder();
      let loadedPages = await readLogseqFolder(handle);
      if (!findJournalByDate(loadedPages)) {
        await ensureJournalFile(handle);
        loadedPages = await readLogseqFolder(handle);
      }
      setRoot(handle);
      setPages(loadedPages);
      setFocusedBlockId(undefined);
      setSelectedTitle((findJournalByDate(loadedPages) ?? loadedPages[0]).title);
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
      const loadedPages = await readLogseqFolder(root);
      setPages(loadedPages);
      setFocusedBlockId(undefined);
      setSelectedTitle((current) =>
        loadedPages.some((page) => page.title === current) ? current : (loadedPages[0]?.title ?? '')
      );
      showNotice('Graph refreshed from disk.');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Could not refresh the graph.');
    } finally {
      setIsLoading(false);
    }
  };

  const selectPage = (title: string, blockId?: string) => {
    setSelectedTitle(title);
    setFocusedBlockId(blockId);
    setIsEditing(false);
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
      await ensureJournalFile(root);
      const loadedPages = await readLogseqFolder(root);
      setPages(loadedPages);
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

  const openLink = (target: string) => {
    const linkedPage = pages.find(
      (page) => normalizePageTitle(page.title) === normalizePageTitle(target)
    );
    if (linkedPage) {
      selectPage(linkedPage.title);
    } else {
      showNotice(
        `No page named “${target}” yet. Create it in your Logseq graph to complete the link.`
      );
    }
  };

  const startEditing = () => {
    if (!selectedPage) return;
    const recovered = localStorage.getItem(`loam:draft:${selectedPage.path}`);
    const content = recovered ?? selectedPage.content;
    setDraft(content);
    setEditorFinalNewline(content.endsWith('\n'));
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
      setPages((current) =>
        reindexPages(
          current.map((page) =>
            page.path === selectedPage.path ? { ...page, content: draft } : page
          )
        )
      );
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
    const content = serializeMarkdownBlocks(blocks, editorFinalNewline);
    setEditorBlocks(blocks);
    setDraft(content);
    if (selectedPage) localStorage.setItem(`loam:draft:${selectedPage.path}`, content);
  };

  const handleCreatePage = async (event: Event) => {
    event.preventDefault();
    if (!root || !newPageTitle.trim()) return;
    try {
      await createPageFile(root, newPageTitle);
      const loadedPages = await readLogseqFolder(root);
      setPages(loadedPages);
      const created = loadedPages.find(
        (page) => normalizePageTitle(page.title) === normalizePageTitle(newPageTitle)
      );
      if (created) selectPage(created.title);
      setNewPageTitle('');
      showNotice(`Created “${newPageTitle.trim()}”.`);
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
      await appendJournalCapture(root, captured);
      const loadedPages = await readLogseqFolder(root);
      setPages(loadedPages);
      const today = findJournalByDate(loadedPages);
      if (today) selectPage(today.title);
      showNotice('Captured in today’s journal.');
    } catch (error) {
      setCaptureText(captured);
      showNotice(error instanceof Error ? error.message : 'Could not capture this block.');
    }
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

          <div className='sidebar-section-heading'>
            <span>Pages</span>
            <span className='count-pill'>{filteredPages.length}</span>
          </div>
          <nav className='page-list' aria-label='Pages'>
            {filteredPages.map((page) => (
              <button
                className={`page-nav-item ${page.title === selectedPage?.title ? 'page-nav-active' : ''}`}
                aria-current={page.title === selectedPage?.title ? 'page' : undefined}
                key={page.path}
                onClick={() => selectPage(page.title)}
                type='button'
              >
                <span className='page-nav-icon'>
                  <Icon name='book' size={15} />
                </span>
                <span className='page-nav-title'>{page.title}</span>
                {page.backlinks.length > 0 && (
                  <span className='page-nav-count'>{page.backlinks.length}</span>
                )}
              </button>
            ))}
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
                {isDemo ? 'Your graph stays local.' : `${pages.length} markdown pages indexed.`}
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
          {selectedPage ? (
            <>
              <div className='page-toolbar'>
                <div className='breadcrumbs'>
                  <span>Pages</span>
                  <Icon name='chevron' size={14} />
                  <span>{selectedPage.title}</span>
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
                      <Icon name='arrow' size={14} /> {selectedPage.backlinks.length} backlinks
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
                          const content = event.currentTarget.value;
                          setDraft(content);
                          localStorage.setItem(`loam:draft:${selectedPage.path}`, content);
                        }}
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
                    pagePath={selectedPage.path}
                    pageTitle={selectedPage.title}
                    root={root}
                  />
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
          {selectedPage ? (
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
