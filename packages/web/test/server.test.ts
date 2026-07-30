import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../src/server.js';

describe('Web Server', () => {
  it('should return health check', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('should return Loam config', async () => {
    const response = await request(app).get('/api/config');
    expect(response.body.name).toBe('Loam');
  });
});
