import { describe, expect, it } from 'vitest';
import {
  blockDomId,
  createBlockNavigationTarget,
  filterCommandPaletteItems,
  rememberSearchQuery,
} from '../src/client/navigation-model.js';

describe('block navigation model', () => {
  it('keeps page context, exact block identity, and query together', () => {
    expect(
      createBlockNavigationTarget({ path: 'pages/a.md', title: 'A' }, 'web_abc', '  needle ')
    ).toEqual({
      blockId: 'web_abc',
      pagePath: 'pages/a.md',
      pageTitle: 'A',
      query: 'needle',
    });
    expect(blockDomId('web_abc')).toBe('page-block-web_abc');
  });

  it('retains recent search history without duplicate entries', () => {
    expect(rememberSearchQuery(['old', 'needle'], ' needle ')).toEqual(['needle', 'old']);
    expect(rememberSearchQuery(['old'], '')).toEqual(['old']);
  });

  it('filters commands by their label and description', () => {
    const commands = [
      { description: 'Create it in pages/', label: 'New page' },
      { description: 'Find pages and blocks', label: 'Search' },
    ];

    expect(filterCommandPaletteItems(commands, '  create it  ')).toEqual([commands[0]]);
    expect(filterCommandPaletteItems(commands, '')).toEqual(commands);
  });
});
