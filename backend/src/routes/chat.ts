import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { chat } from '../services/chat.js';

const schema = z.object({ message: z.string().min(1).max(4000), sessionId: z.string().optional(), customerReference: z.string().max(200).optional() });

export async function chatRoutes(app: FastifyInstance) {
  app.post('/api/v1/chat', async (request, reply) => {
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    try { return await chat(parsed.data); }
    catch (error) { request.log.error(error); return reply.code(502).send({ error: 'Chat service temporarily unavailable' }); }
  });
}
