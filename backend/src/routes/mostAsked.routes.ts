import { FastifyInstance } from 'fastify';
import { getMostAskedQuestions } from '../services/mostAsked.js';

export async function mostAskedRoutes(app: FastifyInstance) {
  app.get('/api/v1/chat/most-asked', async (_request, reply) => {
    try {
      const questions = await getMostAskedQuestions(3);

      return reply.send({
        questions
      });
    } catch (error) {
      app.log.error(error);

      return reply.code(500).send({
        error: 'Failed to load most asked questions'
      });
    }
  });
}