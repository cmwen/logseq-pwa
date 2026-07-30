import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CoreService } from '@template/core';
import express, { type Express } from 'express';

export async function startWebMode(port: number = 3000) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const app: Express = express();

  const config = {
    name: 'Template CLI - Web Mode',
    version: '0.1.0',
    environment: (process.env.NODE_ENV as 'development' | 'production') || 'development',
  };

  const coreService = new CoreService(config);

  // Middleware
  app.use(express.json());

  // NOTE: For production use, consider adding rate limiting middleware
  // Example: npm install express-rate-limit
  // import rateLimit from 'express-rate-limit';
  // const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
  // app.use('/api/', limiter);

  // API Routes
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/config', (_req, res) => {
    res.json(coreService.getConfig());
  });

  app.post('/api/greet', (req, res) => {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    res.json({ message: coreService.greet(name) });
  });

  // Serve static files if client bundle exists
  // Note: In bundled CLI, static files would be embedded or served from a known path
  // This is a placeholder for the web UI integration

  return new Promise<void>((resolve) => {
    app.listen(port, () => {
      console.log(`🚀 Template CLI - Web server running at http://localhost:${port}`);
      console.log(`   API endpoints available at http://localhost:${port}/api/`);
      resolve();
    });
  });
}
