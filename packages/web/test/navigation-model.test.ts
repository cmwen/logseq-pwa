import { describe, expect, it } from 'vitest';
import {
  blockDomId,
  createBlockNavigationTarget,
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
});
