import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  addTicketMessage,
  claimTicket,
  getTicket,
  listCustomers,
  listTickets,
  resolveTicket
} from '../services/tickets.js';

import { env } from '../config/env.js';

function adminAuthorized(request: any) {
  if (!env.ADMIN_TOKEN) {
    return env.NODE_ENV !== 'production';
  }

  const auth = String(request.headers.authorization || '');
  return auth === `Bearer ${env.ADMIN_TOKEN}`;
}

function requireAdmin(request: any, reply: any) {
  if (!adminAuthorized(request)) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }

  return true;
}

export async function ticketRoutes(app: FastifyInstance) {
  // List tickets
  app.get('/api/v1/tickets', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;

    const query = request.query as {
      status?: string;
    };

    const validStatuses = [
      'open',
      'assigned',
      'in_progress',
      'waiting_customer',
      'resolved',
      'closed'
    ] as const;

    const status = validStatuses.includes(
      query.status as (typeof validStatuses)[number]
    )
      ? (query.status as (typeof validStatuses)[number])
      : undefined;

    return {
      tickets: await listTickets(status)
    };
  });

  // Get ticket
  app.get('/api/v1/tickets/:ticketId', async (request, reply) => {
    const { ticketId } = request.params as {
      ticketId: string;
    };

    const ticket = await getTicket(ticketId);

    if (!ticket) {
      return reply.code(404).send({
        error: 'Ticket not found'
      });
    }

    return ticket;
  });

  // Claim ticket
  app.post('/api/v1/tickets/:ticketId/claim', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;

    const { ticketId } = request.params as {
      ticketId: string;
    };

    const result = await claimTicket(ticketId);

    if (!result) {
      return reply.code(404).send({
        error: 'Ticket not available'
      });
    }

    return result;
  });

  // Resolve ticket
  app.patch('/api/v1/tickets/:ticketId/resolve', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;

    const { ticketId } = request.params as {
      ticketId: string;
    };

    const result = await resolveTicket(ticketId);

    if (!result) {
      return reply.code(404).send({
        error: 'Ticket not found'
      });
    }

    return result;
  });

  // Reply to ticket
  app.post('/api/v1/tickets/:ticketId/reply', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;

    const parsed = z
      .object({
        text: z.string().min(1).max(5000)
      })
      .safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid reply'
      });
    }

    const { ticketId } = request.params as {
      ticketId: string;
    };

    const message = await addTicketMessage(
      ticketId,
      'agent',
      parsed.data.text
    );

    if (!message) {
      return reply.code(404).send({
        error: 'Ticket not found'
      });
    }

    return message;
  });

  // Provider Panel compatibility API.
  // The Provider Panel uses these routes while the chatbot keeps /api/v1/tickets.
  app.get('/api/support/tickets', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;

    const tickets = await listTickets();

    return tickets.map((ticket: any) => ({
      id: ticket.ticketId,
      sessionId: ticket.conversationId,
      audience: ticket.category,
      question: ticket.subject || ticket.description,
      status: ticket.status === 'open' ? 'unassigned' : ticket.status,
      createdAt: new Date(ticket.createdAt).toISOString(),
      messages: (ticket.messages ?? []).map((message: any) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        createdAt: new Date(message.createdAt).toISOString()
      }))
    }));
  });

  app.post('/api/support/tickets/:ticketId/claim', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;

    const { ticketId } = request.params as { ticketId: string };
    const result = await claimTicket(ticketId);

    if (!result) {
      return reply.code(404).send({ error: 'Ticket not available' });
    }

    return result;
  });

  app.patch('/api/support/tickets/:ticketId/resolve', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;

    const { ticketId } = request.params as { ticketId: string };
    const result = await resolveTicket(ticketId);

    if (!result) {
      return reply.code(404).send({ error: 'Ticket not found' });
    }

    return result;
  });

  app.post('/api/support/tickets/:ticketId/reply', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;

    const parsed = z
      .object({ text: z.string().min(1).max(5000) })
      .safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid reply' });
    }

    const { ticketId } = request.params as { ticketId: string };
    const message = await addTicketMessage(ticketId, 'agent', parsed.data.text);

    if (!message) {
      return reply.code(404).send({ error: 'Ticket not found' });
    }

    return message;
  });


  app.get('/api/support/customers', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    return await listCustomers();
  });


  // List customers
  app.get('/api/v1/customers', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;

    return await listCustomers();
  });
}