#!/usr/bin/env node

import { Command } from 'commander';
import { formatDiagnostic, GraphStore, parseDate } from './graph.js';
import { startMcpMode } from './modes/mcp.js';
import { startWebMode } from './modes/web.js';

export { configPayload, createWebApp, healthPayload, startWebMode } from './modes/web.js';

export const program = new Command();

type CommandOptions = Record<string, unknown>;

function graphPath(pathArgument: unknown, options: CommandOptions): string {
  const explicit =
    typeof pathArgument === 'string' && pathArgument.trim() ? pathArgument : undefined;
  const inherited = program.opts().graph;
  const option =
    typeof options.graph === 'string' && options.graph.trim()
      ? options.graph
      : typeof inherited === 'string' && inherited.trim()
        ? inherited
        : undefined;
  return explicit ?? option ?? process.cwd();
}

function jsonOutput(options: CommandOptions): boolean {
  return options.json === true;
}

function print(value: unknown, options: CommandOptions, fallback: () => void): void {
  if (jsonOutput(options)) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  fallback();
}

async function run(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function addInfoCommand(parent: Command, name = 'info'): void {
  parent
    .command(name)
    .description('Show Loam graph information')
    .argument('[graphPath]', 'Path to a Logseq graph')
    .option('-j, --json', 'Print JSON')
    .action((pathArgument: string, options: CommandOptions) =>
      run(async () => {
        const value = await new GraphStore(graphPath(pathArgument, options)).info();
        print(value, options, () => {
          console.log(`Graph: ${value.root}`);
          console.log(`Pages: ${value.pageCount}`);
          console.log(`Journals: ${value.journalCount}`);
          console.log(`Attachments: ${value.attachmentCount}`);
        });
      })
    );
}

function addListCommand(parent: Command, name = 'list'): void {
  parent
    .command(name)
    .alias('pages')
    .description('List graph pages and journals')
    .argument('[graphPath]', 'Path to a Logseq graph')
    .option('-j, --json', 'Print JSON')
    .action((pathArgument: string, options: CommandOptions) =>
      run(async () => {
        const pages = await new GraphStore(graphPath(pathArgument, options)).pages();
        print(pages, options, () => {
          for (const page of pages) console.log(`${page.title}\t${page.path}`);
        });
      })
    );
}

function addReadCommand(parent: Command): void {
  parent
    .command('read')
    .description('Read a page by normalized title or safe relative path')
    .argument('<titleOrPath>', 'Page title or graph-relative .md path')
    .argument('[graphPath]', 'Path to a Logseq graph')
    .option('-j, --json', 'Print JSON')
    .action((reference: string, pathArgument: string, options: CommandOptions) =>
      run(async () => {
        const page = await new GraphStore(graphPath(pathArgument, options)).findPage(reference);
        print(page, options, () => {
          console.log(`# ${page.title}`);
          console.log(`Path: ${page.path}`);
          console.log('');
          console.log(page.content);
        });
      })
    );
}

function addSearchCommand(parent: Command): void {
  parent
    .command('search')
    .description('Search blocks with page and ancestor context')
    .argument('<query>', 'Text to search for')
    .argument('[graphPath]', 'Path to a Logseq graph')
    .option('-p, --page <titleOrPath>', 'Restrict search to one page')
    .option('-j, --json', 'Print JSON')
    .action((query: string, pathArgument: string, options: CommandOptions) =>
      run(async () => {
        const results = await new GraphStore(graphPath(pathArgument, options)).searchBlocks(
          query,
          typeof options.page === 'string' ? options.page : undefined
        );
        print(results, options, () => {
          for (const result of results) {
            const context = result.context ? ` (${result.context})` : '';
            console.log(`${result.pageTitle} [${result.pagePath}]${context}`);
            console.log(`  - ${result.content}`);
          }
        });
      })
    );
}

function addBacklinksCommand(parent: Command): void {
  parent
    .command('backlinks')
    .description('List pages and blocks linking to a page')
    .argument('<titleOrPath>', 'Page title or graph-relative .md path')
    .argument('[graphPath]', 'Path to a Logseq graph')
    .option('-j, --json', 'Print JSON')
    .action((reference: string, pathArgument: string, options: CommandOptions) =>
      run(async () => {
        const results = await new GraphStore(graphPath(pathArgument, options)).backlinks(reference);
        print(results, options, () => {
          for (const result of results) {
            console.log(`${result.pageTitle}\t${result.pagePath}`);
            for (const block of result.blocks) console.log(`  - ${block.content}`);
          }
        });
      })
    );
}

function addCaptureCommand(parent: Command): void {
  parent
    .command('capture')
    .description('Append a top-level block to a dated journal')
    .argument('<content>', 'Capture text')
    .argument('[graphPath]', 'Path to a Logseq graph')
    .option('-d, --date <YYYY-MM-DD>', 'Journal date')
    .option('-j, --json', 'Print JSON')
    .action((content: string, pathArgument: string, options: CommandOptions) =>
      run(async () => {
        const date = typeof options.date === 'string' ? parseDate(options.date) : new Date();
        const page = await new GraphStore(graphPath(pathArgument, options)).capture(content, date);
        print(page, options, () => console.log(`Captured to ${page.path}`));
      })
    );
}

function addCreateCommand(parent: Command): void {
  parent
    .command('create')
    .description('Create a namespace-safe page under pages/')
    .argument('<title>', 'Page title, using / for namespaces')
    .argument('[graphPath]', 'Path to a Logseq graph')
    .option('-c, --content <markdown>', 'Initial Markdown content')
    .option('-j, --json', 'Print JSON')
    .action((title: string, pathArgument: string, options: CommandOptions) =>
      run(async () => {
        const content = typeof options.content === 'string' ? options.content : undefined;
        const page = await new GraphStore(graphPath(pathArgument, options)).createPage(
          title,
          content
        );
        print(page, options, () => console.log(`Created ${page.title} at ${page.path}`));
      })
    );
}

function addValidateCommand(parent: Command, name = 'validate'): void {
  parent
    .command(name)
    .alias('migrate-report')
    .description('Read-only graph validation and migration report')
    .argument('[graphPath]', 'Path to a Logseq graph')
    .option('-j, --json', 'Print JSON')
    .action((pathArgument: string, options: CommandOptions) =>
      run(async () => {
        const report = await new GraphStore(graphPath(pathArgument, options)).validate();
        print(report, options, () => {
          console.log(`Checked ${report.checkedPages} pages (read-only)`);
          if (report.diagnostics.length === 0) {
            console.log('No migration concerns found.');
            return;
          }
          for (const diagnostic of report.diagnostics) console.log(formatDiagnostic(diagnostic));
          console.log(
            `Summary: ${report.summary.errors} errors, ${report.summary.warnings} warnings`
          );
        });
        if (report.summary.errors > 0) process.exitCode = 2;
      })
    );
}

function addGraphCommands(parent: Command): void {
  addInfoCommand(parent);
  addListCommand(parent);
  addReadCommand(parent);
  addSearchCommand(parent);
  addBacklinksCommand(parent);
  addCaptureCommand(parent);
  addCreateCommand(parent);
  addValidateCommand(parent);
}

program
  .name('loam')
  .description('Local-first Logseq graph operations')
  .version('0.1.0')
  .option('-g, --graph <path>', 'Default graph path for commands');

addGraphCommands(program);

const graph = program.command('graph').description('Run operations against a Logseq graph');
addGraphCommands(graph);

program
  .command('mcp')
  .description('Start the Loam MCP server on stdio')
  .argument('[graphPath]', 'Path to a Logseq graph; defaults to LOAM_GRAPH_ROOT')
  .action((pathArgument: string | undefined) =>
    run(() =>
      startMcpMode(
        pathArgument ||
          (typeof program.opts().graph === 'string' ? program.opts().graph : undefined)
      )
    )
  );

program
  .command('web')
  .description('Serve the built web client and optional graph REST API')
  .argument('[graphPath]', 'Path to a Logseq graph')
  .option('-p, --port <number>', 'Port to run the web server on', '3000')
  .action((pathArgument: string, options: CommandOptions) =>
    run(async () => {
      const port = Number.parseInt(String(options.port), 10);
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error('Port must be 1-65535.');
      const configuredGraph =
        pathArgument ||
        (typeof program.opts().graph === 'string' ? program.opts().graph : undefined);
      await startWebMode(port, configuredGraph);
    })
  );

if (/(?:^|[\\/])(index|bundled|loam)(?:\.js|\.ts)?$/u.test(process.argv[1] ?? '')) {
  program.parse();
}
