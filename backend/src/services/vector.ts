import { QdrantClient } from '@qdrant/js-client-rest';

import { env } from '../config/env.js';
import { KnowledgeRecord, SearchHit } from '../models/types.js';

let client: QdrantClient | null = null;

/**
 * Create Qdrant client only when Qdrant is actually required.
 * In mock mode, Qdrant is completely disabled.
 */
function getClient(): QdrantClient {
  if (env.CHATBOT_MODE === 'mock') {
    throw new Error('Qdrant is disabled in mock mode');
  }

  if (!client) {
    client = new QdrantClient({
      url: env.QDRANT_URL,
      ...(env.QDRANT_API_KEY
        ? { apiKey: env.QDRANT_API_KEY }
        : {})
    });
  }

  return client;
}

/**
 * Create the Qdrant collection if it does not exist.
 */
export async function ensureCollection(): Promise<void> {
  if (env.CHATBOT_MODE === 'mock') {
    return;
  }

  const qdrant = getClient();

  const collections = await qdrant.getCollections();

  const exists = collections.collections.some(
    (collection) => collection.name === env.QDRANT_COLLECTION
  );

  if (!exists) {
    await qdrant.createCollection(env.QDRANT_COLLECTION, {
      vectors: {
        size: env.VECTOR_SIZE,
        distance: 'Cosine'
      }
    });
  }
}

/**
 * Store an embedding vector in Qdrant.
 */
export async function upsertVector(
  record: KnowledgeRecord,
  vector: number[]
): Promise<void> {
  if (env.CHATBOT_MODE === 'mock') {
    return;
  }

  const qdrant = getClient();

  await qdrant.upsert(env.QDRANT_COLLECTION, {
    wait: true,
    points: [
      {
        id: record.id,
        vector,
        payload: {
          ...record,
          embedding: undefined
        }
      }
    ]
  });
}

/**
 * Search Qdrant using vector similarity.
 */
export async function vectorSearch(
  vector: number[],
  limit: number = env.TOP_K_VECTOR
): Promise<SearchHit[]> {
  if (env.CHATBOT_MODE === 'mock') {
    return [];
  }

  const qdrant = getClient();

  const result = await qdrant.query(env.QDRANT_COLLECTION, {
    query: vector,
    limit,
    with_payload: true
  });

  return result.points.map((point) => ({
    ...(point.payload as unknown as KnowledgeRecord),
    score: Number(point.score ?? 0),
    sourceType: 'vector' as const
  }));
}