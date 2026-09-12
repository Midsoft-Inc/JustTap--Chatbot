
import crypto from 'node:crypto';
import { mongoDb } from '../db/mongo.js';

const COLLECTION = 'chatbot_cache';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const L1_TTL_MS = 5 * 60 * 1000;
const L1_MAX_ENTRIES = 500;

type L1Entry = {
  value: CachedAnswer;
  expiresAt: number;
};

// Small process-local L1 cache. MongoDB remains the authoritative cross-device
// cache; L1 only removes repeated Mongo round-trips on the same server process.
const l1 = new Map<string, L1Entry>();

function l1Get(key: string): CachedAnswer | null {
  const entry = l1.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    l1.delete(key);
    return null;
  }
  // Refresh insertion order so the map behaves like a small LRU.
  l1.delete(key);
  l1.set(key, entry);
  return entry.value;
}

function l1Set(key: string, value: CachedAnswer, ttlMs: number = L1_TTL_MS): void {
  l1.delete(key);
  l1.set(key, { value, expiresAt: Date.now() + ttlMs });
  while (l1.size > L1_MAX_ENTRIES) {
    const oldest = l1.keys().next().value as string | undefined;
    if (!oldest) break;
    l1.delete(oldest);
  }
}

type CacheDocument = {
  _id: string;
  answer: string;
  intent: string;
  category: string;
  normalizedMessage: string;
  language: string;
  createdAt: Date;
  expiresAt: Date;
};

export type CachedAnswer = {
  answer: string;
  intent: string;
  category: string;
};

function cacheKey(normalizedMessage: string, language: string): string {
  const query = normalizedMessage
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  const lang = (language || 'en').trim().toLowerCase();

  return crypto
    .createHash('sha256')
    .update(`${lang}:${query}`, 'utf8')
    .digest('hex');
}

/**
 * Returns a previously generated grounded answer for the same normalized
 * question and response language. Session ID is intentionally not used.
 */
export async function getCachedAnswer(
  normalizedMessage: string,
  language: string
): Promise<CachedAnswer | null> {
  if (!normalizedMessage.trim()) return null;

  const key = cacheKey(normalizedMessage, language);

  const local = l1Get(key);
  if (local) return local;

  const collection = mongoDb().collection<CacheDocument>(COLLECTION);

  const doc = await collection.findOne({
    _id: key,
    expiresAt: { $gt: new Date() }
  });

  if (!doc) return null;

  const value = {
    answer: doc.answer,
    intent: doc.intent,
    category: doc.category
  };
  l1Set(key, value);
  return value;
}

/**
 * Stores a grounded answer using a deterministic string _id. MongoDB will
 * not generate an ObjectId here, so cache lookups and writes use the exact
 * same key type and work consistently with the current mongodb typings.
 */
export async function setCachedAnswer(
  normalizedMessage: string,
  language: string,
  value: CachedAnswer,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<void> {
  if (!normalizedMessage.trim() || !value.answer.trim()) return;

  const now = new Date();
  const key = cacheKey(normalizedMessage, language);
  const expiresAt = new Date(now.getTime() + ttlMs);
  const cacheValue: CachedAnswer = {
    answer: value.answer,
    intent: value.intent,
    category: value.category
  };

  // Populate L1 immediately. The Mongo write below is the durable,
  // cross-device cache and can complete asynchronously from chat.ts.
  l1Set(key, cacheValue);

  const collection = mongoDb().collection<CacheDocument>(COLLECTION);

  await collection.updateOne(
    { _id: key },
    {
      $set: {
        _id: key,
        answer: value.answer,
        intent: value.intent,
        category: value.category,
        normalizedMessage: normalizedMessage.trim(),
        language: (language || 'en').trim().toLowerCase(),
        createdAt: now,
        expiresAt
      }
    },
    { upsert: true }
  );
}
