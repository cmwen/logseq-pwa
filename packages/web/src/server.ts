#!/usr/bin/env node

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { configPayload, createWebApp, healthPayload } from '@loam/cli';
import type { Express } from 'express';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const app: Express = createWebApp({
  graphPath: process.env.LOAM_GRAPH_ROOT,
  webClientDirectory: join(currentDirectory, 'client'),
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number.parseInt(process.env.PORT || '3000', 10);
  app.listen(port, '127.0.0.1', () => {
    console.log(`Loam web server running at http://127.0.0.1:${port}`);
  });
}

export default app;
export { configPayload, healthPayload };
