import { CoreService } from '@template/core';
import { Command } from 'commander';
import { startMcpMode } from './modes/mcp.js';
import { startWebMode } from './modes/web.js';

const program = new Command();

const config = {
  name: 'Template CLI',
  version: '0.1.0',
  environment: 'development' as const,
};

const coreService = new CoreService(config);

program
  .name('template-cli')
  .description('Unified CLI with support for CLI, Web, and MCP modes')
  .version('0.1.0');

// CLI mode commands
program
  .command('greet')
  .description('Greet a user')
  .argument('<name>', 'Name to greet')
  .action((name: string) => {
    console.log(coreService.greet(name));
  });

program
  .command('info')
  .description('Show application info')
  .action(() => {
    const cfg = coreService.getConfig();
    console.log('Application Info:');
    console.log(`  Name: ${cfg.name}`);
    console.log(`  Version: ${cfg.version}`);
    console.log(`  Environment: ${cfg.environment}`);
  });

// MCP mode
program
  .command('mcp')
  .description('Start MCP (Model Context Protocol) server for AI agent integration')
  .action(async () => {
    try {
      await startMcpMode();
    } catch (error) {
      console.error('Failed to start MCP server:', error);
      process.exit(1);
    }
  });

// Web mode
program
  .command('web')
  .description('Start web server with REST API')
  .option('-p, --port <number>', 'Port to run the web server on', '3000')
  .action(async (options) => {
    try {
      const port = Number.parseInt(options.port, 10);
      await startWebMode(port);
    } catch (error) {
      console.error('Failed to start web server:', error);
      process.exit(1);
    }
  });

program.parse();
