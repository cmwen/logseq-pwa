#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import {
  analyzeMigration,
  type Block,
  buildWorkspaceIndex,
  findContextualBacklinks,
  type MigrationReport,
  normalizePageTitle,
  searchWorkspaceBlocks,
} from '@loam/core';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  GraphError,
  type GraphPage,
  GraphStore,
  type GraphStoreOptions,
  graphRootFromEnvironment,
} from './graph.js';

export interface McpServerOptions extends Partial<GraphStoreOptions> {
  environment?: NodeJS.ProcessEnv;
}

export interface ToolCall {
  name: string;
  arguments?: unknown;
}

export interface McpServerInstance {
  server: Server;
  graph: GraphStore;
  listTools: () => Tool[];
  callTool: (name: string, argumentsValue?: unknown) => Promise<CallToolResult>;
}

const pageReferenceSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    path: z.string().trim().min(1).optional(),
    page: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.title || value.path || value.page), {
    message: 'Provide a page title or relative Markdown path.',
  })
  .refine(
    (value) =>
      Number(Boolean(value.title)) + Number(Boolean(value.path)) + Number(Boolean(value.page)) ===
      1,
    {
      message: 'Provide exactly one of title, path, or page.',
    }
  );

const listPagesSchema = z
  .object({
    query: z.string().trim().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict();

const searchBlocksSchema = z
  .object({
    query: z.string().trim().min(1),
    page: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict();

const captureTodaySchema = z
  .object({
    content: z.string().trim().min(1),
    date: z.string().trim().optional().describe('Optional local date in YYYY-MM-DD format.'),
  })
  .strict();

const createPageSchema = z
  .object({
    title: z.string().trim().min(1),
    content: z.string().optional(),
  })
  .strict();

const writePageSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    path: z.string().trim().min(1).optional(),
    page: z.string().trim().min(1).optional(),
    content: z.string(),
    expectedContent: z.string(),
  })
  .strict()
  .refine((value) => Boolean(value.title || value.path || value.page), {
    message: 'Provide a page title or relative Markdown path.',
  })
  .refine(
    (value) =>
      Number(Boolean(value.title)) + Number(Boolean(value.path)) + Number(Boolean(value.page)) ===
      1,
    {
      message: 'Provide exactly one of title, path, or page.',
    }
  );

const emptySchema = z.object({}).strict();

const toolDefinitions: Tool[] = [
  {
    name: 'list_pages',
    description: 'List Markdown pages in the configured Logseq graph.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional case-insensitive title/path filter.' },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'read_page',
    description: 'Read a page by normalized title or graph-relative Markdown path.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Normalized page title.' },
        path: { type: 'string', description: 'Graph-relative Markdown path.' },
        page: { type: 'string', description: 'Alias for title.' },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'search_blocks',
    description: 'Search block content with page and ancestor context.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Case-insensitive text to find in blocks.' },
        page: { type: 'string', description: 'Optional page title or path filter.' },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'get_backlinks',
    description: 'Find exact source blocks that link to a page.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Target page title.' },
        path: { type: 'string', description: 'Target page path.' },
        page: { type: 'string', description: 'Alias for target page title.' },
      },
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'capture_today',
    description: "Append a top-level block to today's journal.",
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Text to capture as a journal block.' },
        date: { type: 'string', description: 'Optional local date in YYYY-MM-DD format.' },
      },
      required: ['content', 'expectedContent'],
    },
    annotations: { destructiveHint: false, idempotentHint: false },
  },
  {
    name: 'create_page',
    description: 'Create a new page under the graph pages directory.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'New page title.' },
        content: { type: 'string', description: 'Optional initial Markdown content.' },
      },
      required: ['title'],
    },
    annotations: { destructiveHint: false, idempotentHint: false },
  },
  {
    name: 'write_page',
    description: 'Replace an existing page, optionally requiring exact expectedContent.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Page title.' },
        path: { type: 'string', description: 'Graph-relative Markdown path.' },
        page: { type: 'string', description: 'Alias for title.' },
        content: { type: 'string', description: 'Replacement Markdown content.' },
        expectedContent: {
          type: 'string',
          description: 'Exact content read by the caller before writing; mismatches are rejected.',
        },
      },
      required: ['content'],
    },
    annotations: { destructiveHint: true, idempotentHint: true },
  },
  {
    name: 'validate_graph',
    description: 'Read-only graph validation and migration report.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
];

function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

function pageReference(value: z.infer<typeof pageReferenceSchema>): {
  title?: string;
  path?: string;
  page?: string;
} {
  return { title: value.title, path: value.path, page: value.page };
}

interface BlockContext {
  id: string;
  parentId: string | null;
  position: number;
  content: string;
  properties: Record<string, string>;
  references: string[];
  tags: string[];
}

function blockContext(block: Block): BlockContext {
  return {
    id: block.id,
    parentId: block.parentId,
    position: block.position,
    content: block.content,
    properties: block.properties,
    references: block.references,
    tags: block.tags,
  };
}

function pageSummary(page: GraphPage): Record<string, unknown> {
  return {
    title: page.title,
    path: page.path,
    links: page.links,
    backlinks: page.backlinks,
  };
}

async function handleListPages(graph: GraphStore, rawArguments: unknown): Promise<CallToolResult> {
  const input = listPagesSchema.parse(rawArguments ?? {});
  const pages = await graph.readPages();
  const query = input.query?.toLocaleLowerCase();
  const filtered = pages.filter(
    (page) => !query || `${page.title} ${page.path}`.toLocaleLowerCase().includes(query)
  );
  const limited = filtered.slice(0, input.limit ?? 500);
  return jsonResult({
    pages: limited.map(pageSummary),
    count: limited.length,
    total: filtered.length,
  });
}

async function handleReadPage(graph: GraphStore, rawArguments: unknown): Promise<CallToolResult> {
  const input = pageReferenceSchema.parse(rawArguments ?? {});
  const page = await graph.findPage(pageReference(input));
  return jsonResult({ ...pageSummary(page), content: page.content });
}

async function handleSearchBlocks(
  graph: GraphStore,
  rawArguments: unknown
): Promise<CallToolResult> {
  const input = searchBlocksSchema.parse(rawArguments ?? {});
  const index = buildWorkspaceIndex(await graph.readPages());
  const contexts = searchWorkspaceBlocks(index, input.query, {
    page: input.page,
    limit: input.limit,
  });
  const matches = contexts.map((context) => ({
    page: { title: context.page.title, path: context.page.path },
    block: blockContext(context.block),
    ancestors: context.ancestors.map(blockContext),
  }));
  return jsonResult({ query: input.query, matches, count: matches.length });
}

async function handleBacklinks(graph: GraphStore, rawArguments: unknown): Promise<CallToolResult> {
  const input = pageReferenceSchema.parse(rawArguments ?? {});
  const target = await graph.findPage(pageReference(input));
  const index = buildWorkspaceIndex(await graph.readPages());
  const backlinks = findContextualBacklinks(index, target.title).map((context) => ({
    sourcePage: { title: context.page.title, path: context.page.path },
    sourceBlock: blockContext(context.block),
    link: { target: context.target, label: context.label },
    ancestors: context.ancestors.map(blockContext),
  }));
  return jsonResult({ target: pageSummary(target), backlinks, count: backlinks.length });
}

async function handleCaptureToday(
  graph: GraphStore,
  rawArguments: unknown
): Promise<CallToolResult> {
  const input = captureTodaySchema.parse(rawArguments ?? {});
  const page = await graph.captureToday(input.content, input.date);
  return jsonResult({ page: pageSummary(page), content: page.content });
}

async function handleCreatePage(graph: GraphStore, rawArguments: unknown): Promise<CallToolResult> {
  const input = createPageSchema.parse(rawArguments ?? {});
  const page = await graph.createPage(input.title, input.content);
  return jsonResult({ page: pageSummary(page), content: page.content });
}

async function handleWritePage(graph: GraphStore, rawArguments: unknown): Promise<CallToolResult> {
  const input = writePageSchema.parse(rawArguments ?? {});
  const page = await graph.findPage(pageReference(input));
  const written = await graph.writePage(page.path, input.content, input.expectedContent);
  return jsonResult({ page: pageSummary(written), content: written.content });
}

async function handleValidateGraph(
  graph: GraphStore,
  rawArguments: unknown
): Promise<CallToolResult> {
  emptySchema.parse(rawArguments ?? {});
  return jsonResult(await validateGraph(graph));
}

type ToolHandler = (graph: GraphStore, rawArguments: unknown) => Promise<CallToolResult>;

const toolHandlers: Record<string, ToolHandler> = {
  list_pages: handleListPages,
  read_page: handleReadPage,
  search_blocks: handleSearchBlocks,
  get_backlinks: handleBacklinks,
  capture_today: handleCaptureToday,
  create_page: handleCreatePage,
  write_page: handleWritePage,
  validate_graph: handleValidateGraph,
};

async function dispatchTool(
  graph: GraphStore,
  name: string,
  rawArguments: unknown
): Promise<CallToolResult> {
  const handler = toolHandlers[name];
  if (!handler) throw new GraphError(`Unknown tool: ${name}`);
  return handler(graph, rawArguments);
}

function normalizeTarget(value: string): string {
  return normalizePageTitle(value);
}

interface ValidationDetails {
  errors: Record<string, string>[];
  warnings: Record<string, string>[];
  migrationIssues: Record<string, string>[];
  migrationReport: MigrationReport;
}

function inspectPages(pages: GraphPage[]): ValidationDetails {
  const errors: Record<string, string>[] = [];
  const migrationIssues: Record<string, string>[] = [];
  const migrationReport = analyzeMigration(pages).report;
  try {
    buildWorkspaceIndex(pages);
  } catch (error) {
    errors.push({
      path: '.',
      message: error instanceof Error ? error.message : String(error),
    });
  }
  for (const page of pages) {
    if (!page.path.startsWith('pages/') && !page.path.startsWith('journals/')) {
      migrationIssues.push({
        path: page.path,
        message: 'Markdown file is outside pages/ or journals/.',
      });
    }
  }
  for (const duplicate of migrationReport.duplicatePageNames) {
    errors.push({
      path: duplicate.pages.map((page) => page.path).join(', '),
      message: `Duplicate normalized page title: "${duplicate.normalizedTitle}".`,
    });
  }
  return {
    errors,
    warnings: missingLinkWarnings(pages),
    migrationIssues,
    migrationReport,
  };
}

function missingLinkWarnings(pages: GraphPage[]): Record<string, string>[] {
  const warnings: Record<string, string>[] = [];
  const knownTitles = new Set(pages.map((page) => normalizeTarget(page.title)));
  for (const page of pages) {
    for (const link of page.links) {
      if (!knownTitles.has(normalizeTarget(link.target))) {
        warnings.push({
          path: page.path,
          message: `Link target does not exist: "${link.target}".`,
        });
      }
    }
  }
  return warnings;
}

async function validateGraph(graph: GraphStore): Promise<Record<string, unknown>> {
  let pages: GraphPage[] = [];
  let details: ValidationDetails = {
    errors: [],
    warnings: [],
    migrationIssues: [],
    migrationReport: analyzeMigration([]).report,
  };
  try {
    pages = await graph.readPages();
    details = inspectPages(pages);
  } catch (error) {
    details.errors.push({
      path: '.',
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return {
    valid: details.errors.length === 0,
    graphRoot: graph.root,
    pageCount: pages.length,
    errors: details.errors,
    warnings: details.warnings,
    migration: {
      required:
        details.migrationIssues.length > 0 ||
        details.migrationReport.unsupportedConstructs.length > 0 ||
        details.migrationReport.malformedPageReferences.length > 0 ||
        details.migrationReport.duplicatePageNames.length > 0 ||
        details.migrationReport.conflictingDuplicateBlockProperties.length > 0 ||
        details.migrationReport.attachmentReferences.length > 0,
      issues: details.migrationIssues,
      report: details.migrationReport,
    },
  };
}

export function createMcpServer(options: McpServerOptions = {}): McpServerInstance {
  const graph = new GraphStore({
    graphRoot: options.graphRoot ?? graphRootFromEnvironment(options.environment),
    now: options.now,
  });
  const server = new Server(
    { name: 'loam-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );
  const listTools = (): Tool[] => toolDefinitions.map((tool) => structuredClone(tool));
  const callTool = async (name: string, argumentsValue?: unknown): Promise<CallToolResult> => {
    try {
      return await dispatchTool(graph, name, argumentsValue);
    } catch (error) {
      return errorResult(error);
    }
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listTools() }));
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    callTool(request.params.name, request.params.arguments)
  );
  return { server, graph, listTools, callTool };
}

export const createServer = createMcpServer;

export async function startMcpServer(options: McpServerOptions = {}): Promise<McpServerInstance> {
  const instance = createMcpServer(options);
  await instance.server.connect(new StdioServerTransport());
  console.error('Loam MCP server running on stdio');
  return instance;
}

export async function main(): Promise<void> {
  await startMcpServer();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('Loam MCP server error:', error);
    process.exitCode = 1;
  });
}
