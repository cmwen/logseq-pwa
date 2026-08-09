import { describe, expect, it } from 'vitest';
import { configPayload, healthPayload } from '../src/server.js';

describe('Web Server', () => {
  it('returns a deterministic health payload without requiring a network listener', () => {
    expect(healthPayload(false, new Date('2026-08-09T00:00:00.000Z'))).toEqual({
      status: 'ok',
      graphConfigured: false,
      timestamp: '2026-08-09T00:00:00.000Z',
    });
  });

  it('returns Loam config', () => {
    expect(configPayload(false)).toMatchObject({ name: 'Loam', version: '0.1.0' });
  });
});
