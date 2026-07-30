# Loam Design Notes

## Overview

Loam is a local-first PWA for reading and editing a Logseq graph. The first release keeps the interaction model deliberately small: open a folder, select a page, follow links, inspect backlinks, and save edits back to the same folder.

## Architecture

```text
Browser
  ├─ File System Access API ──> selected Logseq folder
  ├─ Core parser/indexer ─────> page titles, outgoing links, backlinks
  └─ Preact UI ───────────────> page reader, editor, search, page map
                                    │
                                    └─ static Vite build ──> GitHub Pages
```

The app is client-only when deployed. No graph content is sent to a Loam server. The existing Express, CLI, and MCP packages remain as extension points from the base monorepo, but are not required by the Pages build.

### Core package

`packages/core/src/logseq.ts` contains framework-agnostic helpers for:

- normalizing Logseq page names and filenames;
- extracting `[[Page]]` and `[[Page|alias]]` references;
- building outgoing-link and backlink relationships.

The core package has no browser or filesystem dependency, so the indexing behavior can be tested independently.

### Web package

`packages/web/src/client/logseq.ts` adapts the browser File System Access API. It recursively reads `.md` files, retains each file handle for writes, and creates new pages under `pages/`. `App.tsx` owns the current graph selection and UI state; the rendered page body intentionally supports a small, safe subset of Logseq markdown rather than trying to be a full Markdown engine.

### Local file behavior

1. The user selects a graph root with `showDirectoryPicker({ mode: 'readwrite' })`.
2. Loam reads markdown files in that folder and its child directories.
3. The core indexer maps page titles to links and backlinks.
4. Saving calls `FileSystemFileHandle.createWritable()` for the selected page.
5. Refreshing repeats the read/index pass so edits made in Logseq or another editor appear.

The demo graph is in-memory and read-only. It exists so the UI and link interactions can be evaluated before a folder is granted.

## Scope boundaries

Included: page reading, lightweight Logseq rendering, page search, page links, backlinks, editing, saving, page creation, and PWA shell caching.

Not included: Datalog queries, charts, graph visualization, sync, authentication, cloud storage, or server-side parsing.

## Deployment

Vite builds `packages/web/src/client` to `packages/web/dist/client` with a relative base path so the artifact works at a GitHub Pages project URL. `.github/workflows/deploy-pages.yml` uploads that directory using the official Pages artifact and deploy actions.
