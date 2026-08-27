import { FastifyInstance } from 'fastify';
import { mongoDb } from '../db/mongo.js';
import { env } from '../config/env.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/api/v1/health', async () => {
    await mongoDb().command({ ping: 1 });
    return { status: 'ok', service: 'justtap-chatbot', environment: env.NODE_ENV, time: new Date().toISOString() };
  });
}
