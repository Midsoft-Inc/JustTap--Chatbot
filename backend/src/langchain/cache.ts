// src/langchain/cache.ts
//
// Latency optimization: repeated/common questions ("how to login
// justtap", "how to book a plumber") shouldn't re-run the semantic
// chain + retrieval + reranker + generation every single time. This
// caches the final answer for the *grounded* stage only, keyed by
// normalized message + language, in the same Mongo connection every
// other file already uses (services/chat.ts, langchain/memory.ts) --
// no new connection, no new service.
//
// Only "grounded" stage answers are cached. Ticket confirmations
// contain a unique ticket ID and must never be cached; clarification/
// small-talk replies are already cheap lookups with no LLM call, so
// caching them buys nothing.
//
// The collection and indexes are created automatically by the application. No
// manual MongoDB Atlas setup is required. A TTL index on `expiresAt` removes
// expired cache documents automatically; reads also reject expired entries
// so correctness does not depend on the TTL monitor running immediately.

import crypto from 'node:crypto';

import { mongoDb } from '../db/mongo.js';
import { env } from '../config/env.js';

const COLLECTION = 'answer_cache';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

const mockCache = new Map<string, { answer: string; expiresAt: number }>();
let cacheIndexesPromise: Promise<void> | null = null;

async function ensureCacheIndexes(): Promise<void> {
  if (env.CHATBOT_MODE === 'mock') return;
  if (!cacheIndexesPromise) {
    cacheIndexesPromise = mongoDb().collection(COLLECTION).createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0 }
    ).then(() => undefined).catch((error) => {
      cacheIndexesPromise = null;
      throw error;
    });
  }
  await cacheIndexesPromise;
}


export type CachedAnswer = {
  answer: string;
  intent: string;
  category: string;
};

function cacheKey(normalizedMessage: string, language: string): string {
  return crypto
    .createHash('sha256')
    .update(`${language}::${normalizedMessage.trim().toLowerCase()}`)
    .digest('hex');
}

export async function getCachedAnswer(
  normalizedMessage: string,
  language: string
): Promise<CachedAnswer | null> {
  if (!normalizedMessage.trim()) return null;
  const key = cacheKey(normalizedMessage, language);

  if (env.CHATBOT_MODE === 'mock') {
    const hit = mockCache.get(key);
    if (!hit || hit.expiresAt < Date.now()) return null;
    return { answer: hit.answer, intent: 'cached', category: 'cached' };
  }

  try {
    await ensureCacheIndexes();
    const doc = await mongoDb().collection(COLLECTION).findOne({ _id: key });
    if (!doc) return null;
    if (doc.expiresAt && new Date(doc.expiresAt).getTime() < Date.now()) return null;
    return { answer: doc.answer, intent: doc.intent, category: doc.category };
  } catch {
    // Cache is an optimization, not a dependency -- a lookup failure
    // should fall through to the normal pipeline, not fail the request.
    return null;
  }
}

export async function setCachedAnswer(
  normalizedMessage: string,
  language: string,
  value: CachedAnswer
): Promise<void> {
  if (!normalizedMessage.trim() || !value.answer.trim()) return;
  const key = cacheKey(normalizedMessage, language);

  if (env.CHATBOT_MODE === 'mock') {
    mockCache.set(key, { answer: value.answer, expiresAt: Date.now() + CACHE_TTL_MS });
    return;
  }

  try {
    await ensureCacheIndexes();
    await mongoDb()
      .collection(COLLECTION)
      .updateOne(
        { _id: key },
        {
          $set: {
            answer: value.answer,
            intent: value.intent,
            category: value.category,
            language,
            normalizedMessage,
            expiresAt: new Date(Date.now() + CACHE_TTL_MS),
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );
  } catch {
    // Best-effort write; never fail the customer's turn over a cache miss.
  }
}
