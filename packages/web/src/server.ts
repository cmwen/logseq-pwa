#!/usr/bin/env node

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CoreService } from '@template/core';
import express, { type Express } from 'express';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app: Express = express();
const port = process.env.PORT || 3000;

const config = {
  name: 'Template Web',
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

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(join(__dirname, 'client')));

  app.get('*', (_req, res) => {
    res.sendFile(join(__dirname, 'client', 'index.html'));
  });
}

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen(port, () => {
    console.log(`🚀 Server running at http://localhost:${port}`);
  });
}

export default app;
