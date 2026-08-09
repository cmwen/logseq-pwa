# Loam

Loam is a small, journal-first block outliner for a local Markdown workspace. It is designed to deploy as a static PWA on GitHub Pages: your files are opened directly in the browser and are never sent to a server.

## What is included

- Open a Logseq graph folder with the browser File System Access API.
- Recursively index markdown pages from the graph root, including `pages/` and `journals/`.
- Read lightweight Logseq markdown with headings, bullets, tasks, tags, and `[[page links]]`.
- Follow page links and inspect backlinks in a two-way page map.
- Edit nested blocks independently with split, merge, indent, outdent, reorder, collapse, undo, and redo.
- Autosave portable nested Markdown back to the selected local folder with external-change protection and local draft recovery.
- Open today's journal first, navigate existing journals, and quick-capture a block to today from anywhere.
- Search individual blocks, including references, tags, and properties, with parent context.
- Create a new page under the graph's `pages/` directory.
- Refresh the index after changing files outside Loam.
- Install the static shell as a PWA and use the demo graph before opening a folder.

Drag-and-drop, focused block mode, multi-block selection, queries, charts, and graph visualizations remain out of scope for this first MVP.

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

## Structure

```text
packages/
├── core/       # Pure Logseq title, link, and backlink indexing helpers
└── web/        # Preact UI, File System Access adapter, PWA shell, and Pages build
```

The remaining CLI/MCP packages are retained from the original monorepo foundation for future integrations; they are not required by the static GitHub Pages build.
