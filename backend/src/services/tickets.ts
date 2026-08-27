import crypto from 'node:crypto';
import { mongoDb } from '../db/mongo.js';
import { Ticket } from '../models/types.js';
import { env } from '../config/env.js';

type TicketMessage = { id: string; ticketId: string; role: 'agent' | 'customer'; text: string; createdAt: Date };
const mockTickets = new Map<string, Ticket>();
const mockMessages = new Map<string, TicketMessage[]>();

export async function createTicket(input: Omit<Ticket, 'ticketId' | 'createdAt' | 'updatedAt' | 'status' | 'slaHours'>) {
  const now = new Date();
  const ticket: Ticket = {
    ...input,
    ticketId: `TKT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    status: 'open',
    slaHours: 24,
    createdAt: now,
    updatedAt: now
  };

  const message: TicketMessage = {
    id: crypto.randomUUID(),
    ticketId: ticket.ticketId,
    role: 'customer',
    text: input.description,
    createdAt: now
  };

  if (env.CHATBOT_MODE === 'mock') {
    mockTickets.set(ticket.ticketId, ticket);
    mockMessages.set(ticket.ticketId, [message]);
    return ticket;
  }

  await mongoDb().collection('tickets').insertOne(ticket);
  await mongoDb().collection('ticket_messages').insertOne(message);
  return ticket;
}

export async function getTicket(ticketId: string) {
  if (env.CHATBOT_MODE === 'mock') {
    const ticket = mockTickets.get(ticketId);
    if (!ticket) return null;
    return { ...ticket, messages: mockMessages.get(ticketId) ?? [] };
  }

  const ticket = await mongoDb().collection<Ticket>('tickets').findOne({ ticketId });
  if (!ticket) return null;
  const messages = await mongoDb().collection('ticket_messages').find({ ticketId }).sort({ createdAt: 1 }).toArray();
  return { ...ticket, messages };
}

export async function listTickets(status?: Ticket['status']) {
  if (env.CHATBOT_MODE === 'mock') {
    return [...mockTickets.values()]
      .filter(t => !status || t.status === status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 100)
      .map(t => ({ ...t, messages: mockMessages.get(t.ticketId) ?? [] }));
  }

  const filter: Partial<Pick<Ticket, 'status'>> = status ? { status } : {};
  const tickets = await mongoDb().collection<Ticket>('tickets').find(filter).sort({ createdAt: -1 }).limit(100).toArray();
  return Promise.all(tickets.map(async ticket => ({
    ...ticket,
    messages: await mongoDb().collection('ticket_messages').find({ ticketId: ticket.ticketId }).sort({ createdAt: 1 }).toArray()
  })));
}

export async function claimTicket(ticketId: string, agentId = 'support-agent') {
  const now = new Date();

  if (env.CHATBOT_MODE === 'mock') {
    const ticket = mockTickets.get(ticketId);
    if (!ticket || !['open', 'assigned'].includes(ticket.status)) return null;
    const updated = { ...ticket, status: 'in_progress' as const, assignedTo: agentId, updatedAt: now };
    mockTickets.set(ticketId, updated);
    return updated;
  }

  return mongoDb().collection<Ticket>('tickets').findOneAndUpdate(
    { ticketId, status: { $in: ['open', 'assigned'] } },
    { $set: { status: 'in_progress', assignedTo: agentId, updatedAt: now } },
    { returnDocument: 'after' }
  );
}

export async function resolveTicket(ticketId: string, agentId = 'support-agent') {
  const now = new Date();

  if (env.CHATBOT_MODE === 'mock') {
    const ticket = mockTickets.get(ticketId);
    if (!ticket || ticket.status === 'closed') return null;
    const updated = { ...ticket, status: 'resolved' as const, assignedTo: agentId, updatedAt: now };
    mockTickets.set(ticketId, updated);
    return updated;
  }

  return mongoDb().collection<Ticket>('tickets').findOneAndUpdate(
    { ticketId, status: { $ne: 'closed' } },
    { $set: { status: 'resolved', assignedTo: agentId, updatedAt: now } },
    { returnDocument: 'after' }
  );
}

export async function addTicketMessage(ticketId: string, role: 'agent' | 'customer', text: string) {
  const exists = env.CHATBOT_MODE === 'mock'
    ? mockTickets.has(ticketId)
    : await mongoDb().collection('tickets').findOne({ ticketId });

  if (!exists) return null;

  const message: TicketMessage = { id: crypto.randomUUID(), ticketId, role, text, createdAt: new Date() };

  if (env.CHATBOT_MODE === 'mock') {
    const messages = mockMessages.get(ticketId) ?? [];
    messages.push(message);
    mockMessages.set(ticketId, messages);
    const ticket = mockTickets.get(ticketId)!;
    mockTickets.set(ticketId, { ...ticket, updatedAt: new Date() });
    return message;
  }

  await mongoDb().collection('ticket_messages').insertOne(message);
  await mongoDb().collection('tickets').updateOne({ ticketId }, { $set: { updatedAt: new Date() } });
  return message;
}

export async function listCustomers() {
  if (env.CHATBOT_MODE === 'mock') {
    const groups = new Map<string, { sessionId?: string; customerReference?: string; tickets: number; lastActivity: Date }>();
    for (const t of mockTickets.values()) {
      const key = t.customerReference ?? 'anonymous';
      const current = groups.get(key);
      if (!current || t.updatedAt > current.lastActivity) {
        groups.set(key, { sessionId: t.conversationId, customerReference: t.customerReference, tickets: (current?.tickets ?? 0) + 1, lastActivity: t.updatedAt });
      } else {
        current.tickets += 1;
      }
    }
    return [...groups.values()].sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime()).slice(0, 100);
  }

  return mongoDb().collection('tickets').aggregate([
    { $group: { _id: '$customerReference', sessionId: { $first: '$conversationId' }, tickets: { $sum: 1 }, lastActivity: { $max: '$updatedAt' } } },
    { $sort: { lastActivity: -1 } },
    { $limit: 100 },
    { $project: { _id: 0, sessionId: 1, customerReference: '$_id', tickets: 1, lastActivity: 1 } }
  ]).toArray();
}
