// src/langchain/memory.ts
//
// Conversation state + memory layer used by the semantic chain to resolve
// context across turns (diagram: "Conversation State" -> feeds back into
// the Semantic LLM Chain). Reuses the existing Mongo connection in
// production mode; in mock mode (no DB configured) it keeps a small
// in-process buffer per session so local/dev runs still get real
// multi-turn context instead of none at all.

import { mongoDb } from '../db/mongo.js';
import { env } from '../config/env.js';

export type MemoryTurn = {
  role: 'user' | 'assistant';
  content: string;
  intent?: string;
  service?: string | null;
  createdAt: Date;
};

const MAX_TURNS = 6;

const mockMemory = new Map<string, MemoryTurn[]>();

export async function getRecentTurns(sessionId: string): Promise<MemoryTurn[]> {
  if (!sessionId) return [];

  if (env.CHATBOT_MODE === 'mock') {
    return (mockMemory.get(sessionId) ?? []).slice(-MAX_TURNS);
  }

  try {
    const docs = await mongoDb()
      .collection('messages')
      .find({ sessionId })
      .sort({ createdAt: -1 })
      .limit(MAX_TURNS)
      .toArray();

    return docs
      .reverse()
      .map((d: any) => ({
        role: d.role,
        content: d.content,
        intent: d.intent,
        service: d.service ?? null,
        createdAt: d.createdAt
      }));
  } catch {
    // Memory is an enhancement, not a hard dependency -- if it's ever
    // unavailable, fall through to a stateless turn rather than failing
    // the whole conversation.
    return [];
  }
}

export function rememberMockTurn(sessionId: string, turn: MemoryTurn) {
  if (env.CHATBOT_MODE !== 'mock' || !sessionId) return;
  const list = mockMemory.get(sessionId) ?? [];
  list.push(turn);
  mockMemory.set(sessionId, list.slice(-MAX_TURNS * 2));
}

export function formatTurnsForPrompt(turns: MemoryTurn[]): string {
  if (!turns.length) return '(no prior conversation)';
  return turns
    .map((t) => `${t.role === 'user' ? 'Customer' : 'Assistant'}: ${t.content}`)
    .join('\n');
}
