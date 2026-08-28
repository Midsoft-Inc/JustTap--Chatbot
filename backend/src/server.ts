import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import dns from 'node:dns';

import { env } from './config/env.js';
import { connectMongo } from './db/mongo.js';
import { ensureCollection } from './services/vector.js';
import { chatRoutes } from './routes/chat.js';
import { ticketRoutes } from './routes/tickets.js';
import { healthRoutes } from './routes/health.js';

// Use reliable DNS servers for MongoDB Atlas SRV resolution.
dns.setServers(['8.8.8.8', '1.1.1.1']);

export const app = Fastify({
  logger: true,
  bodyLimit: 512 * 1024
});

// Prevent initialization from happening multiple times
// when the Vercel function is reused.
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

// Local development only.
// Vercel provides its own HTTP server.
if (process.env.VERCEL !== '1') {
  await initializeApp();

  await app.listen({
    port: env.PORT,
    host: env.HOST
  });
}