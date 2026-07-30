# Loam

Loam is a small, local-first PWA for reading and editing a Logseq graph. It is designed to deploy as a static site on GitHub Pages: your markdown files are opened directly in the browser and are never sent to a server.

## What is included

- Open a Logseq graph folder with the browser File System Access API.
- Recursively index markdown pages from the graph root, including `pages/` and `journals/`.
- Read lightweight Logseq markdown with headings, bullets, tasks, tags, and `[[page links]]`.
- Follow page links and inspect backlinks in a two-way page map.
- Edit and save pages back to the selected local folder.
- Create a new page under the graph's `pages/` directory.
- Refresh the index after changing files outside Loam.
- Install the static shell as a PWA and use the demo graph before opening a folder.

Queries, charts, and graph visualizations are intentionally out of scope for this starter.

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
