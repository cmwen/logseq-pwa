# Loam Data and Browser API

Loam is a static client application. It does not expose a server API for graph content.

## Local folder adapter

The web client uses the browser File System Access API:

```ts
const graph = await window.showDirectoryPicker({ mode: 'readwrite' });
const file = await graph.getFileHandle('pages/Welcome.md');
const writable = await file.createWritable();
await writable.write('# Welcome\n\n- Updated locally');
await writable.close();
```

The browser controls permission prompts. Loam only reads the folder selected by the user and does not upload its contents.

## Core page types

`packages/core/src/logseq.ts` exports the pure indexing helpers:

```ts
interface PageLink {
  target: string;
  label: string;
}

interface PageInput {
  title: string;
  path: string;
  content: string;
}

interface IndexedPage extends PageInput {
  links: PageLink[];
  backlinks: string[];
}
```

`extractPageLinks(content)` reads `[[Page]]` and `[[Page|alias]]` references. `buildPageIndex(pages)` resolves those references into outgoing links and reverse backlinks. `normalizePageTitle(title)` makes links resilient to common Logseq filename forms such as `Project_Name.md`.

## Supported page syntax

The starter reader intentionally supports a small subset of Logseq markdown:

- headings (`#`, `##`, `###`);
- bullet blocks (`-` and `*`);
- task markers (`TODO`, `DONE`, `LATER`);
- page links and aliases;
- simple `#tags`;
- bold text using `**text**`.

The structured editor is enabled only when the page can round-trip through the block serializer. Other Markdown opens in an exact-source fallback editor so unsupported syntax is never silently rewritten.

## CLI and local REST API

The `loam` CLI supports `info`, `list`, `read`, `search`, `backlinks`, `capture`, `create`, and read-only `validate` commands. `loam web [graphPath]` serves the built client and graph REST endpoints on loopback only.

REST endpoints include `/api/health`, `/api/config`, `/api/graph/info`, `/api/pages`, `/api/page`, `/api/search`, `/api/backlinks`, `/api/capture`, and page creation through `POST /api/pages`.

## MCP tools

The MCP server reads `LOAM_GRAPH_ROOT` unless a graph root is supplied by the embedding process. It exposes page listing/reading, contextual block search and backlinks, journal capture, page creation, conflict-protected page replacement, and graph validation. `write_page` requires the caller's exact `expectedContent` revision.
