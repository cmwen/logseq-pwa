import { buildPageIndex, normalizePageTitle, type PageInput } from '@loam/core';
import { useMemo, useState } from 'preact/hooks';
import {
  createPageFile,
  type LocalPage,
  pickLogseqFolder,
  readLogseqFolder,
  savePage,
  supportsFolderAccess,
} from './logseq.js';
import './styles.css';

const demoPages: PageInput[] = [
  {
    title: 'Welcome to Loam',
    path: 'pages/Welcome_to_Loam.md',
    content:
      '# Welcome to Loam\n\n- A small, local-first reader for your Logseq graph.\n- Everything here is a real page link: [[Working set]] and [[Reading list]].\n- Open your own folder when you are ready.\n\n## A quiet graph\n\nLoam keeps the useful parts of a graph close at hand: pages, backlinks, and the texture of your daily notes. Your files stay exactly where they are.',
  },
  {
    title: 'Working set',
    path: 'pages/Working_set.md',
    content:
      '# Working set\n\n- TODO Sketch the first release\n- DONE Set up local folder access\n- TODO Link the page view to [[Reading list]]\n\nThe best next step is usually the one that makes the graph feel more alive. See [[Welcome to Loam]] for the short tour.',
  },
  {
    title: 'Reading list',
    path: 'pages/Reading_list.md',
    content:
      '# Reading list\n\n- [[The Art of Noticing]] — a reminder to look slowly\n- [[Designing for calm]] — notes on humane interfaces\n- #someday\n\nThis page is linked from [[Working set]]. Unknown links are still shown as links, ready for a page to be created in your graph.',
  },
  {
    title: 'The Art of Noticing',
    path: 'pages/The_Art_of_Noticing.md',
    content:
      '# The Art of Noticing\n\n- A page can be a place to return to, not just a container for facts.\n- Capture the small details before they disappear.\n\nBack to [[Reading list]].',
  },
  {
    title: 'Designing for calm',
    path: 'pages/Designing_for_calm.md',
    content:
      '# Designing for calm\n\n- Make the next action obvious\n- Give information room to breathe\n- Keep the user close to their source of truth\n\nRelated: [[Reading list]] and [[Welcome to Loam]].',
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

function InlineContent({ text, onLink }: { text: string; onLink: (target: string) => void }) {
  const tokens = text.split(/(\[\[[^\]]+\]\]|#[\w/-]+|\*\*[^*]+\*\*)/g);
  const tokenCounts = new Map<string, number>();
  return (
    <>
      {tokens.map((token) => {
        const occurrence = tokenCounts.get(token) ?? 0;
        tokenCounts.set(token, occurrence + 1);
        const tokenKey = `${token}-${occurrence}`;
        if (token.startsWith('[[') && token.endsWith(']]')) {
          const reference = token.slice(2, -2);
          const [target, label] = reference.split('|');
          return (
            <button
              className='inline-link'
              key={tokenKey}
              onClick={() => onLink(target.trim())}
              type='button'
            >
              <Icon name='link' size={13} />
              {label?.trim() || target.trim()}
            </button>
          );
        }
        if (token.startsWith('#')) {
          return (
            <span className='tag' key={tokenKey}>
              {token}
            </span>
          );
        }
        if (token.startsWith('**') && token.endsWith('**')) {
          return <strong key={tokenKey}>{token.slice(2, -2)}</strong>;
        }
        return <span key={tokenKey}>{token}</span>;
      })}
    </>
  );
}

function PageBody({ page, onLink }: { page: LocalPage; onLink: (target: string) => void }) {
  const lines = page.content.split('\n');
  const lineCounts = new Map<string, number>();
  return (
    <div className='page-body'>
      {lines.map((line) => {
        const occurrence = lineCounts.get(line) ?? 0;
        lineCounts.set(line, occurrence + 1);
        const lineKey = `${line}-${occurrence}`;
        const leadingWhitespace = line.match(/^\s*/)?.[0].length ?? 0;
        const trimmed = line.trim();
        if (!trimmed) {
          return <div className='blank-line' key={`blank-${lineKey}`} />;
        }

        const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
        if (heading) {
          const Heading = `h${heading[1].length}` as 'h1' | 'h2' | 'h3';
          return (
            <Heading key={`heading-${lineKey}`}>
              <InlineContent onLink={onLink} text={heading[2]} />
            </Heading>
          );
        }

        const bullet = trimmed.match(/^[-*]\s+(?:(TODO|DONE|LATER)\s+)?(.*)$/);
        if (bullet) {
          const state = bullet[1]?.toLocaleLowerCase();
          return (
            <div
              className='page-block'
              key={`block-${lineKey}`}
              style={{ paddingLeft: `${leadingWhitespace * 8}px` }}
            >
              <span className={`bullet ${state === 'done' ? 'bullet-done' : ''}`}>
                {state === 'done' ? <Icon name='check' size={13} /> : ''}
              </span>
              {state && <span className={`task-state task-${state}`}>{state}</span>}
              <span>
                <InlineContent onLink={onLink} text={bullet[2]} />
              </span>
            </div>
          );
        }

        return (
          <p
            className='page-paragraph'
            key={`paragraph-${lineKey}`}
            style={{ paddingLeft: `${leadingWhitespace * 8}px` }}
          >
            <InlineContent onLink={onLink} text={trimmed} />
          </p>
        );
      })}
    </div>
  );
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
  const [selectedTitle, setSelectedTitle] = useState('Welcome to Loam');
  const [search, setSearch] = useState('');
  const [isDemo, setIsDemo] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [newPageTitle, setNewPageTitle] = useState('');

  const selectedPage = pages.find((page) => page.title === selectedTitle) ?? pages[0];
  const filteredPages = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return pages;
    return pages.filter((page) =>
      `${page.title} ${page.path} ${page.content}`.toLocaleLowerCase().includes(query)
    );
  }, [pages, search]);
  const supported = supportsFolderAccess();

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 4200);
  };

  const openFolder = async () => {
    setIsLoading(true);
    try {
      const handle = await pickLogseqFolder();
      const loadedPages = await readLogseqFolder(handle);
      if (!loadedPages.length) {
        throw new Error(
          'No markdown pages were found in that folder. Choose your Logseq graph root.'
        );
      }
      setRoot(handle);
      setPages(loadedPages);
      setSelectedTitle(loadedPages[0].title);
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

  const selectPage = (title: string) => {
    setSelectedTitle(title);
    setIsEditing(false);
    setSearch('');
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
    setDraft(selectedPage.content);
    setIsEditing(true);
  };

  const saveDraft = async () => {
    if (!selectedPage) return;
    setIsSaving(true);
    try {
      await savePage(selectedPage, draft);
      setPages((current) =>
        reindexPages(
          current.map((page) =>
            page.path === selectedPage.path ? { ...page, content: draft } : page
          )
        )
      );
      setIsEditing(false);
      showNotice('Saved to your Logseq folder.');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Could not save this page.');
    } finally {
      setIsSaving(false);
    }
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
              onInput={(event) => setSearch(event.currentTarget.value)}
              placeholder='Search pages…'
              type='search'
              value={search}
            />
            <kbd>⌘ K</kbd>
          </div>

          <div className='sidebar-section-heading'>
            <span>Pages</span>
            <span className='count-pill'>{filteredPages.length}</span>
          </div>
          <nav className='page-list' aria-label='Pages'>
            {filteredPages.map((page) => (
              <button
                className={`page-nav-item ${page.title === selectedPage?.title ? 'page-nav-active' : ''}`}
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
            {!filteredPages.length && <p className='no-results'>No pages match “{search}”.</p>}
          </nav>

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
                <div className='page-actions'>
                  {isEditing ? (
                    <>
                      <button
                        className='button button-quiet'
                        onClick={() => setIsEditing(false)}
                        type='button'
                      >
                        Cancel
                      </button>
                      <button
                        className='button button-primary save-button'
                        disabled={isSaving}
                        onClick={saveDraft}
                        type='button'
                      >
                        <Icon name='check' size={16} />
                        {isSaving ? 'Saving…' : 'Save page'}
                      </button>
                    </>
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
                  <textarea
                    className='page-editor'
                    onInput={(event) => setDraft(event.currentTarget.value)}
                    value={draft}
                  />
                ) : (
                  <PageBody onLink={openLink} page={selectedPage} />
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
                  <span className='relation-count'>{selectedPage.backlinks.length}</span>
                </div>
                {selectedPage.backlinks.length ? (
                  <div className='relation-list'>
                    {selectedPage.backlinks.map((title) => (
                      <button key={title} onClick={() => selectPage(title)} type='button'>
                        <span className='relation-bullet' />
                        {title}
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

      {root && (
        <form className='quick-create' onSubmit={handleCreatePage}>
          <Icon name='plus' size={17} />
          <input
            aria-label='Create a new page'
            onInput={(event) => setNewPageTitle(event.currentTarget.value)}
            placeholder='New page title…'
            value={newPageTitle}
          />
          <button type='submit'>
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
