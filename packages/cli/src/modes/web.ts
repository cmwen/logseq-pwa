import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express, type Request, type Response } from 'express';
import { GraphStore, parseDate } from '../graph.js';

export interface WebAppOptions {
  graphPath?: string;
  webClientDirectory?: string;
}

function requestValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sendError(res: Response, error: unknown, status = 400): void {
  res.status(status).json({ error: errorMessage(error) });
}

function bodyValue(body: unknown, key: string): unknown {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)[key]
    : undefined;
}

/** Resolves the static client produced by the web package without bundling it into the CLI. */
export function findWebClientDirectory(explicit?: string): string | undefined {
  const candidates = [
    explicit,
    process.env.LOAM_WEB_CLIENT_DIR,
    join(dirname(fileURLToPath(import.meta.url)), '../../../web/dist/client'),
    join(process.cwd(), 'packages/web/dist/client'),
    join(process.cwd(), 'dist/client'),
  ].filter((value): value is string => Boolean(value));
  return candidates.find((value) => existsSync(join(value, 'index.html')));
}

function createGraph(graphPath?: string): GraphStore | undefined {
  return graphPath ? new GraphStore(graphPath) : undefined;
}

export function healthPayload(graphConfigured: boolean, now = new Date()): Record<string, unknown> {
  return { status: 'ok', graphConfigured, timestamp: now.toISOString() };
}

export function configPayload(graphConfigured: boolean): Record<string, unknown> {
  return {
    name: 'Loam',
    version: '0.1.0',
    environment: process.env.NODE_ENV || 'development',
    graphConfigured,
  };
}

/** Creates the REST/static app without opening a network listener, which keeps it easy to test. */
export function createWebApp(options: WebAppOptions = {}): Express {
  const app = express();
  const graph = createGraph(options.graphPath);
  const clientDirectory = findWebClientDirectory(options.webClientDirectory);

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json(healthPayload(Boolean(graph)));
  });

  app.get('/api/config', (_req, res) => {
    res.json(configPayload(Boolean(graph)));
  });

  app.get('/api/graph/info', async (_req, res) => {
    if (!graph) return sendError(res, 'A graph path is required for graph endpoints.', 404);
    try {
      res.json(await graph.info());
    } catch (error) {
      sendError(res, error, 500);
    }
  });

  app.get('/api/pages', async (req, res) => {
    if (!graph) return sendError(res, 'A graph path is required for graph endpoints.', 404);
    try {
      const pages = await graph.pages();
      const query = requestValue(req.query.q);
      const filtered = query
        ? pages.filter((page) =>
            `${page.title} ${page.path}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
          )
        : pages;
      res.json({ pages: filtered });
    } catch (error) {
      sendError(res, error, 500);
    }
  });

  app.get('/api/page', async (req, res) => {
    if (!graph) return sendError(res, 'A graph path is required for graph endpoints.', 404);
    const reference = requestValue(req.query.title) ?? requestValue(req.query.path);
    if (!reference) return sendError(res, 'Provide a page title or safe relative path.');
    try {
      res.json(await graph.findPage(reference));
    } catch (error) {
      sendError(res, error, errorMessage(error).includes('not found') ? 404 : 400);
    }
  });

  app.get('/api/search', async (req, res) => {
    if (!graph) return sendError(res, 'A graph path is required for graph endpoints.', 404);
    const query = requestValue(req.query.q);
    if (!query) return sendError(res, 'Provide a non-empty q search query.');
    try {
      res.json({ results: await graph.searchBlocks(query, requestValue(req.query.page)) });
    } catch (error) {
      sendError(res, error, errorMessage(error).includes('not found') ? 404 : 400);
    }
  });

  app.get('/api/backlinks', async (req, res) => {
    if (!graph) return sendError(res, 'A graph path is required for graph endpoints.', 404);
    const reference = requestValue(req.query.title) ?? requestValue(req.query.path);
    if (!reference) return sendError(res, 'Provide a page title or safe relative path.');
    try {
      res.json({ backlinks: await graph.backlinks(reference) });
    } catch (error) {
      sendError(res, error, errorMessage(error).includes('not found') ? 404 : 400);
    }
  });

  app.post('/api/capture', async (req, res) => {
    if (!graph) return sendError(res, 'A graph path is required for graph endpoints.', 404);
    const content = requestValue(bodyValue(req.body, 'content'));
    if (!content) return sendError(res, 'Capture content is required.');
    const dateText = requestValue(bodyValue(req.body, 'date'));
    try {
      res
        .status(201)
        .json({ page: await graph.capture(content, dateText ? parseDate(dateText) : new Date()) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/pages', async (req, res) => {
    if (!graph) return sendError(res, 'A graph path is required for graph endpoints.', 404);
    const title = requestValue(bodyValue(req.body, 'title'));
    const contentValue = bodyValue(req.body, 'content');
    if (!title) return sendError(res, 'Page title is required.');
    if (contentValue !== undefined && typeof contentValue !== 'string') {
      return sendError(res, 'Page content must be a string.');
    }
    const content = contentValue;
    try {
      res.status(201).json({ page: await graph.createPage(title, content) });
    } catch (error) {
      sendError(res, error, errorMessage(error).includes('already exists') ? 409 : 400);
    }
  });

  if (clientDirectory) {
    app.use(express.static(clientDirectory));
    app.use((req: Request, res: Response, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      res.sendFile(join(clientDirectory, 'index.html'));
    });
  }

  return app;
}

export async function startWebMode(port = 3000, graphPath?: string): Promise<void> {
  const app = createWebApp({ graphPath });
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => {
      console.log(`Loam web server running at http://localhost:${port}`);
      console.log(`REST endpoints available at http://localhost:${port}/api/`);
      resolve();
    });
    server.once('error', reject);
  });
}
