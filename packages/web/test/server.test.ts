import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../src/server.js';

describe('Web Server', () => {
  it('should return health check', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('should return config', async () => {
    const response = await request(app).get('/api/config');
    expect(response.status).toBe(200);
    expect(response.body.name).toBe('Template Web');
  });

  it('should greet with name', async () => {
    const response = await request(app).post('/api/greet').send({ name: 'Test' });
    expect(response.status).toBe(200);
    expect(response.body.message).toContain('Test');
  });

  it('should return 400 without name', async () => {
    const response = await request(app).post('/api/greet').send({});
    expect(response.status).toBe(400);
  });
});
