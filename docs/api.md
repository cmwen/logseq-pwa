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

The editor preserves the complete original page text, including syntax that the reader does not render specially.
