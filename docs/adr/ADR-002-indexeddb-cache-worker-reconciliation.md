# ADR-002 — Use an IndexedDB Cache with Worker-Based Reconciliation

## Status

**Accepted**

## Date

2026-08-24

## Decision Owners

Project owner / primary user

---

## Context

The PWA reads a user-selected Logseq graph through the browser File System Access API. A complete startup pass currently enumerates Markdown files, reads their contents, parses blocks, and rebuilds page links and backlinks. Repeating that work on every reopen will make a larger graph feel slow and can block the UI while parsing.

The graph may also be edited by Logseq or another application while Loam is closed. The Markdown files must therefore remain portable and authoritative; a browser cache cannot be treated as the only copy of the graph. Link navigation and backlinks need to remain fast when a single page changes.

Loam-created page metadata should use a format that can be understood by other Markdown tools. Cache bookkeeping, parser versions, and file fingerprints are implementation details and should not pollute user-authored notes.

## Decision

Loam will use a **cache-first IndexedDB architecture with background reconciliation in a dedicated Web Worker**.

### Markdown and frontmatter

YAML frontmatter is the portable metadata format for Loam-created pages. Loam-specific keys are namespaced with `loam-`, for example:

```yaml
---
loam-id: 8cb91130-a427-44a8-b35d-99d5dcac5b5a
loam-schema: 1
created: 2026-08-24T10:30:00+10:00
---
```

Loam will preserve unknown frontmatter and avoid rewriting its formatting unnecessarily. The block parser receives the Markdown body after frontmatter has been separated. Cache timestamps, file fingerprints, backlink data, and indexer versions stay in IndexedDB rather than being written into the Markdown file.

### IndexedDB cache

IndexedDB stores a versioned, rebuildable projection of the graph, including:

* graph identity and the persisted `FileSystemDirectoryHandle` when supported;
* page identity, path, frontmatter, and parsed body/block data;
* file fingerprint fields such as `size` and `lastModified`;
* outgoing link edges and indexes for resolving backlinks;
* schema and indexer versions needed to invalidate incompatible records.

The Markdown graph remains the source of truth. IndexedDB is disposable: it may be evicted, unavailable, stale, or invalidated after an indexer change, and Loam must be able to rebuild it from disk.

### Startup and reconciliation

Startup follows this sequence:

1. Restore the cached graph and render it as soon as possible.
2. Restore the directory handle from IndexedDB and check its permission state.
3. Start one reconciliation job for the graph in a dedicated Web Worker.
4. Enumerate the relevant graph directories and compare each file's `size` and `lastModified` with its cached fingerprint.
5. Read and parse only new or changed files. Replace that page's blocks and outgoing edges in one IndexedDB transaction.
6. Remove records for files no longer present and publish the reconciled projection only if the
   job is still the newest generation.

The main thread owns rendering, input, and permission prompts. The worker owns enumeration, frontmatter/body parsing, block extraction, link extraction, and reconciliation bookkeeping. Reconciliation reports progress and never replaces the cached UI with an empty state while it is running. A manual full rebuild remains available.

The worker is a dedicated Web Worker, not the service worker. Service workers may be terminated between events and are reserved for the application shell and network/offline caching.

### Incremental links

Outgoing links are the canonical persisted edge records. Backlinks are obtained through an index by target page key rather than by scanning every page at render time. When a page changes, Loam deletes and recreates only that page's blocks and source edges; unrelated pages and edges remain intact. This keeps two-way link updates proportional to the changed pages.

### Permissions and writes

On a later visit, Loam attempts to rehydrate the stored directory handle and calls `queryPermission()`. A permission prompt may still require a user gesture; if access is unavailable, the cached graph can be shown in read-only mode and the user can reconnect the folder. Successful writes update the corresponding IndexedDB record after the file write, while the existing external-change check remains in place to prevent stale cached content from overwriting another editor's change.

### Implementation language

Reconciliation and parsing will remain TypeScript running in the worker. WebAssembly is deliberately not part of this decision. It can be reconsidered only after profiling demonstrates that parsing is a material CPU bottleneck.

## Consequences

### Benefits

* Reopen is responsive because the cached graph is usable before reconciliation finishes.
* Unchanged files are not reread or reparsed.
* Backlinks and outgoing links can be queried incrementally.
* Markdown remains portable and authoritative.
* The worker keeps large-graph parsing off the main thread.

### Costs and limitations

* There is no broadly portable directory API that reports all changes since a sequence number. Reconciliation still enumerates entries, although it avoids reading unchanged file contents.
* `size` plus `lastModified` is an inexpensive fingerprint, not a cryptographic guarantee; an explicit full rebuild or stronger content hash can recover from ambiguous cases.
* Browser storage can be evicted and directory permissions can change, so cache misses and reconnect flows are required.
* IndexedDB schema/indexer migrations must be versioned and may require a complete rebuild.
* Concurrent tabs and overlapping reconciliation jobs need a single-job or generation-token guard so stale worker results cannot overwrite newer state.

## Alternatives considered

### `localStorage`

Rejected for graph data. It is synchronous, string-only, small, and does not provide suitable structured indexes or reliable storage for file handles. It remains appropriate for small UI preferences such as the selected page or theme.

### A manifest stored in the graph folder

Rejected as the correctness mechanism. An external editor can change a page without updating Loam's manifest, leaving it stale. A manifest may be added later as an optimization, but reconciliation must remain capable of discovering additions, deletions, and renames.

### Service-worker reconciliation

Rejected because service-worker lifetime is event-driven and unpredictable. The dedicated worker has a clear request/response lifetime and is appropriate for CPU-heavy parsing.

### WebAssembly parser

Deferred. It would not make directory enumeration or IndexedDB access cheaper and would add build, debugging, and data-transfer complexity before profiling establishes a need.

### Full read and parse on every startup

Rejected because it scales with the entire graph and delays first render even when no files changed.

## Recovery and correctness

If the cache is absent, incompatible, corrupt, or explicitly invalidated, Loam performs a complete rebuild from the selected folder. If reconciliation fails partway through, the last consistent cache remains available and the next run retries the affected work. A user-triggered full rebuild is the escape hatch for uncertain fingerprints, missed external changes, or suspected cache/index corruption.
