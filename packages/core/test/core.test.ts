import { describe, expect, it } from 'vitest';
import { CoreService } from '../src/index.js';

describe('CoreService', () => {
  it('should create instance with config', () => {
    const config = {
      name: 'Test App',
      version: '1.0.0',
      environment: 'test' as const,
    };
    const service = new CoreService(config);
    expect(service.getConfig()).toEqual(config);
  });

  it('should greet user', () => {
    const config = {
      name: 'Test App',
      version: '1.0.0',
      environment: 'test' as const,
    };
    const service = new CoreService(config);
    expect(service.greet('World')).toBe('Hello, World! Welcome to Test App.');
  });
});
