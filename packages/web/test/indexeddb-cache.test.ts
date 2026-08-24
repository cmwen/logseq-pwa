import { describe, expect, it } from 'vitest';
import {
  type CachedGraphRecord,
  type CachedLinkEdge,
  type CachedPageRecord,
  createGraphCache,
  GRAPH_CACHE_INDEXER_VERSION,
  GRAPH_CACHE_SCHEMA_VERSION,
} from '../src/client/indexeddb-cache.js';

function page(path: string, graphId = 'graph'): CachedPageRecord {
  return {
    backlinks: [],
    content: `- ${path}`,
    graphId,
    lastModified: 123,
    links: [],
    path,
    size: path.length,
    title: path.replace(/\.md$/u, ''),
  };
}

function graph(id = 'graph'): CachedGraphRecord {
  return {
    id,
    indexerVersion: GRAPH_CACHE_INDEXER_VERSION,
    lastIndexedAt: 456,
    schemaVersion: GRAPH_CACHE_SCHEMA_VERSION,
  };
}

function edge(
  sourcePagePath: string,
  targetTitleKey: string,
  ordinal: number,
  graphId = 'graph'
): CachedLinkEdge {
  return {
    graphId,
    label: targetTitleKey,
    ordinal,
    sourcePagePath,
    sourcePageTitle: sourcePagePath.replace(/^pages\//u, '').replace(/\.md$/u, ''),
    targetTitleKey,
  };
}

describe('graph cache fallback', () => {
  it('stores and loads graph metadata and pages when IndexedDB is unavailable', async () => {
    const cache = await createGraphCache({ indexedDB: null });
    const first = page('pages/first.md');
    const second = page('pages/second.md');

    await cache.saveGraph(graph());
    await cache.upsertPages([second, first]);

    const snapshot = await cache.load('graph');
    expect(snapshot.status.mode).toBe('memory');
    expect(snapshot.status.warning).toContain('will not survive a reload');
    expect(snapshot.graph).toEqual(graph());
    expect(snapshot.pages.map(({ path }) => path)).toEqual(['pages/first.md', 'pages/second.md']);
    expect(snapshot.pages[0]?.size).toBe(first.size);
    expect(snapshot.edges).toEqual([]);
  });

  it('replaces and removes individual records without affecting other graphs', async () => {
    const cache = await createGraphCache({ indexedDB: null });
    await cache.upsertPages([
      page('pages/a.md'),
      page('pages/b.md'),
      page('pages/other.md', 'other'),
    ]);

    await cache.upsertPage({ ...page('pages/a.md'), content: '- changed', size: 9 });
    await cache.removePage('graph', 'pages/b.md');
    await cache.removePages('other', ['pages/other.md']);

    const graphSnapshot = await cache.load('graph');
    const otherSnapshot = await cache.load('other');
    expect(graphSnapshot.pages).toHaveLength(1);
    expect(graphSnapshot.pages[0]?.content).toBe('- changed');
    expect(otherSnapshot.pages).toEqual([]);
  });

  it('clears graph metadata and all of its pages', async () => {
    const cache = await createGraphCache({ indexedDB: null });
    await cache.saveGraph(graph());
    await cache.upsertPage(page('pages/a.md'));
    await cache.clearGraph('graph');

    const snapshot = await cache.load('graph');
    expect(snapshot.graph).toBeUndefined();
    expect(snapshot.pages).toEqual([]);
  });

  it('replaces source edges and answers backlinks by target', async () => {
    const cache = await createGraphCache({ indexedDB: null });
    await cache.replacePageLinks('graph', 'pages/source.md', [
      edge('pages/source.md', 'target', 0),
      edge('pages/source.md', 'other', 1),
    ]);
    await cache.replacePageLinks('graph', 'pages/second.md', [
      edge('pages/second.md', 'target', 0),
    ]);

    expect(await cache.getOutgoingLinks('graph', 'pages/source.md')).toEqual([
      edge('pages/source.md', 'target', 0),
      edge('pages/source.md', 'other', 1),
    ]);
    expect(await cache.getBacklinks('graph', 'target')).toEqual([
      edge('pages/second.md', 'target', 0),
      edge('pages/source.md', 'target', 0),
    ]);

    await cache.replacePageLinks('graph', 'pages/source.md', [
      edge('pages/source.md', 'replacement', 0),
    ]);
    expect(await cache.getBacklinks('graph', 'target')).toEqual([
      edge('pages/second.md', 'target', 0),
    ]);
    expect((await cache.load('graph')).edges).toEqual([
      edge('pages/second.md', 'target', 0),
      edge('pages/source.md', 'replacement', 0),
    ]);
  });

  it('replaces a page and its outgoing link projection together', async () => {
    const cache = await createGraphCache({ indexedDB: null });
    await cache.replacePageProjection(page('pages/source.md'), [
      edge('pages/source.md', 'old-target', 0),
    ]);

    await cache.replacePageProjection(
      { ...page('pages/source.md'), content: '- updated', size: 9 },
      [edge('pages/source.md', 'new-target', 0)]
    );

    const snapshot = await cache.load('graph');
    expect(snapshot.pages[0]?.content).toBe('- updated');
    expect(await cache.getBacklinks('graph', 'old-target')).toEqual([]);
    expect(await cache.getBacklinks('graph', 'new-target')).toEqual([
      edge('pages/source.md', 'new-target', 0),
    ]);
  });

  it('removes source edges with pages and clears all graph edges', async () => {
    const cache = await createGraphCache({ indexedDB: null });
    await cache.replacePageLinks('graph', 'pages/removed.md', [
      edge('pages/removed.md', 'target', 0),
    ]);
    await cache.replacePageLinks('graph', 'pages/kept.md', [edge('pages/kept.md', 'target', 0)]);

    await cache.removePage('graph', 'pages/removed.md');
    expect(await cache.getBacklinks('graph', 'target')).toEqual([
      edge('pages/kept.md', 'target', 0),
    ]);

    await cache.clearGraph('graph');
    expect(await cache.getBacklinks('graph', 'target')).toEqual([]);
    expect((await cache.load('graph')).edges).toEqual([]);
  });
});
