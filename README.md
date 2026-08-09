# Loam

Loam is a small, journal-first block outliner for a local Markdown workspace. It is designed to deploy as a static PWA on GitHub Pages: your files are opened directly in the browser and are never sent to a server.

## What is included

- Open a Logseq graph folder with the browser File System Access API.
- Recursively index markdown pages from the graph root, including `pages/` and `journals/`.
- Read lightweight Logseq markdown with headings, bullets, tasks, tags, and `[[page links]]`.
- Follow page links and inspect backlinks in a two-way page map.
- Edit nested blocks independently with split, merge, indent, outdent, reorder, collapse, undo, and redo.
- Drag complete block subtrees, focus a block with its descendants, and jump to exact search/backlink matches.
- Autosave portable nested Markdown back to the selected local folder with external-change protection and local draft recovery.
- Route rich or unsupported Markdown to an exact-source fallback editor instead of rewriting its syntax.
- Open today's journal first, navigate existing journals, and quick-capture a block to today from anywhere.
- Search individual blocks, including references, tags, and properties, with parent context.
- Create a new page under the graph's `pages/` directory.
- Refresh the index after changing files outside Loam.
- Install the static shell as a PWA and use the demo graph before opening a folder.
- Resolve local image attachments from the selected graph without uploading them.
- Automate the same graph through the `loam` CLI, a loopback REST server, or the MCP server.

Multi-block selection, queries, charts, graph visualization, collaboration, and cloud sync remain out of scope for this MVP.

## Local development

```bash
pnpm install
pnpm --filter @loam/web dev
```

Then open the Vite URL in Chrome or Edge on desktop. The demo graph works immediately. Select `Open folder` to grant access to a Logseq graph root.

Run the complete check suite with:

```bash
pnpm lint:ci
pnpm format:check
pnpm build
pnpm test
```

## GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` builds `packages/web` and deploys `packages/web/dist/client` on pushes to `main`. In the repository settings, set Pages to `GitHub Actions` as the source.

Because the app uses the browser's local folder API, the deployed site needs a secure context. GitHub Pages provides HTTPS automatically. Folder access currently works best in Chromium-based desktop browsers; the demo view remains available elsewhere.

## CLI

Build the CLI and inspect its commands:

```bash
pnpm --filter @loam/cli build
node packages/cli/dist/bundled.js --help
```

Examples:

```bash
loam info /path/to/graph
loam list /path/to/graph
loam read "Project/Now" /path/to/graph
loam search "release plan" /path/to/graph --json
loam backlinks "Project/Now" /path/to/graph
loam capture "Review the plan" /path/to/graph
loam create "Project/Ideas" /path/to/graph
loam validate /path/to/graph
loam web /path/to/graph
```

The local REST server binds to `127.0.0.1` and exposes health, graph info, pages, search, backlinks, capture, and page creation endpoints.

## MCP

Set the graph root and start either MCP entrypoint:

```bash
export LOAM_GRAPH_ROOT=/path/to/graph
pnpm --filter @loam/mcp build
node packages/mcp/dist/server.js
# or: loam mcp /path/to/graph
```

The server exposes `list_pages`, `read_page`, `search_blocks`, `get_backlinks`, `capture_today`, `create_page`, conflict-protected `write_page`, and read-only `validate_graph` tools.

## Structure

```text
packages/
├── core/       # Pure Logseq title, link, and backlink indexing helpers
├── web/        # Preact UI, File System Access adapter, PWA shell, and Pages build
├── cli/        # Graph commands and loopback REST/static server
└── mcp/        # Graph-aware Model Context Protocol server
```
