/**
 * Core package - Business logic and shared utilities
 */

export interface AppConfig {
  name: string;
  version: string;
  environment: 'development' | 'production' | 'test';
}

export class CoreService {
  constructor(private config: AppConfig) {}

  getConfig(): AppConfig {
    return this.config;
  }

  greet(name: string): string {
    return `Hello, ${name}! Welcome to ${this.config.name}.`;
  }
}

export * from './blocks.js';
export * from './compatibility.js';
export * from './logseq.js';
export * from './migration.js';
export * from './utils.js';
export * from './workspace.js';
