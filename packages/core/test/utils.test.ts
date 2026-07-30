import { describe, expect, it } from 'vitest';
import { capitalize, formatDate } from '../src/utils.js';

describe('Utils', () => {
  describe('capitalize', () => {
    it('should capitalize first letter', () => {
      expect(capitalize('hello')).toBe('Hello');
    });

    it('should handle already capitalized', () => {
      expect(capitalize('Hello')).toBe('Hello');
    });

    it('should handle single character', () => {
      expect(capitalize('a')).toBe('A');
    });
  });

  describe('formatDate', () => {
    it('should format date as ISO string', () => {
      const date = new Date('2024-01-01T00:00:00.000Z');
      expect(formatDate(date)).toBe('2024-01-01T00:00:00.000Z');
    });
  });
});
