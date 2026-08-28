import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import dns from 'node:dns';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from './config/env.js';
import { connectMongo } from './db/mongo.js';
import { ensureCollection } from './services/vector.js';
import { chatRoutes } from './routes/chat.js';
import { ticketRoutes } from './routes/tickets.js';
import { healthRoutes } from './routes/health.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = Fastify({
  logger: true,
  bodyLimit: 512 * 1024
});

let initialized = false;

export async function initializeApp() {
  if (initialized) {
    return app;
  }

  await app.register(cors, {
    origin:
      env.CORS_ORIGIN === '*'
        ? true
        : env.CORS_ORIGIN.split(',')
  });

  await app.register(helmet);

  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute'
  });

  if (env.CHATBOT_MODE === 'production') {
    await connectMongo();
    await ensureCollection();
  } else {
    app.log.info(
      'CHATBOT_MODE=mock: MongoDB and Qdrant initialization skipped'
    );
  }

  await app.register(healthRoutes);
  await app.register(chatRoutes);
  await app.register(ticketRoutes);

  // Serve React/Vite frontend
  const frontendPath = path.resolve(__dirname, '../../frontend-dist');

  await app.register(fastifyStatic, {
    root: frontendPath,
    prefix: '/'
  });

  // React SPA fallback
  app.setNotFoundHandler(async (request, reply) => {
    if (
      request.method === 'GET' &&
      !request.url.startsWith('/api/')
    ) {
      return reply.sendFile('index.html');
    }

    return reply.code(404).send({
      message: `Route ${request.method}:${request.url} not found`,
      error: 'Not Found',
      statusCode: 404
    });
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    request.log.error(error);

    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;

    return reply
      .code(statusCode)
      .send({ error: 'Internal server error' });
  });

  await app.ready();

  initialized = true;

  return app;
}

if (process.env.VERCEL !== '1') {
  await initializeApp();

  await app.listen({
    port: env.PORT,
    host: env.HOST
  });
}