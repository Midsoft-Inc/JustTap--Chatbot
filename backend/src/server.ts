

import Fastify from 'fastify';
import { pathToFileURL } from 'node:url';

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';

import { env } from './config/env.js';
import { connectMongo } from './db/mongo.js';
import { ensureCollection } from './services/vector.js';

import { chatRoutes } from './routes/chat.js';
import { ticketRoutes } from './routes/tickets.js';
import { healthRoutes } from './routes/health.js';
console.log('[STARTUP] server.ts loaded');

export const app = Fastify({
  logger: true,
  bodyLimit: 512 * 1024
});

export default app;

let initialized = false;

export async function initializeApp() {
  console.log('[STARTUP] initializeApp: start');

  if (initialized) {
    return app;
  }

  console.log('[STARTUP] registering cors');

  await app.register(cors, {
    origin:
      env.CORS_ORIGIN === '*'
        ? true
        : env.CORS_ORIGIN.split(',')
  });

  console.log('[STARTUP] registering helmet');

  await app.register(helmet);

  console.log('[STARTUP] registering rateLimit');

  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute'
  });

  console.log('[STARTUP] before MongoDB');

  if (env.CHATBOT_MODE === 'production') {
    await connectMongo();

    console.log('[STARTUP] MongoDB connected');

    await ensureCollection();

    console.log('[STARTUP] collection ensured');
  } else {
    app.log.info(
      'CHATBOT_MODE=mock: MongoDB and Qdrant initialization skipped'
    );
  }

  console.log('[STARTUP] registering health');

  await app.register(healthRoutes);

  console.log('[STARTUP] registering chat');

  await app.register(chatRoutes);

  console.log('[STARTUP] registering tickets');

  await app.register(ticketRoutes);

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
      .send({
        error: 'Internal server error'
      });
  });

  console.log('[STARTUP] before ready');

  await app.ready();

  console.log('[STARTUP] app ready');

  initialized = true;

  return app;
}


const isMainModule =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  try {
    await initializeApp();

    await app.listen({
      port: env.PORT,
      host: env.HOST
    });

    console.log('[STARTUP] listen() succeeded, server is up');
  } catch (error) {
    console.error('[STARTUP FAILURE]', error);
    process.exit(1);
  }
}