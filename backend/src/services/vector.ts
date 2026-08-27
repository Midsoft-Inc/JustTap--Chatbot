import { env } from '../config/env.js';
import { mongoDb } from '../db/mongo.js';
import { KnowledgeRecord, SearchHit } from '../models/types.js';

/**
 * MongoDB Atlas Vector Search adapter.
 *
 * The public interface is intentionally kept the same as the previous
 * vector adapter so the existing RAG/LangChain and ingestion flow do not
 * need to change. Only the vector database implementation is changed:
 * Qdrant -> MongoDB Atlas Vector Search.
 */

/**
 * MongoDB Atlas owns the vector index. There is no local collection to
 * create, so this remains a no-op to preserve the existing startup/ingest API.
 */
export async function ensureCollection(): Promise<void> {
  if (env.CHATBOT_MODE === 'mock') return;

  // The Atlas Vector Search index is configured in MongoDB Atlas as
  // `knowledge_vector_index`. connectMongo() also attempts to create it when
  // it is not already present.
}

/**
 * Store an embedding vector in MongoDB alongside its knowledge record.
 * saveKnowledge() stores the normal knowledge fields; this function adds the
 * embedding field used by Atlas Vector Search.
 */
export async function upsertVector(
  record: KnowledgeRecord,
  vector: number[]
): Promise<void> {
  if (env.CHATBOT_MODE === 'mock') return;

  if (vector.length !== env.VECTOR_SIZE) {
    throw new Error(
      `Invalid embedding dimension for ${record.id}: expected ${env.VECTOR_SIZE}, received ${vector.length}`
    );
  }

  await mongoDb()
    .collection<KnowledgeRecord>('knowledge')
    .updateOne(
      { id: record.id },
      { $set: { embedding: vector } },
      { upsert: true }
    );
}

/**
 * Search MongoDB Atlas using the existing embedding vector.
 * The returned shape remains SearchHit[], so the existing hybrid RAG
 * and LangChain layers continue to work unchanged.
 */
export async function vectorSearch(
  vector: number[],
  limit: number = env.TOP_K_VECTOR
): Promise<SearchHit[]> {
  if (env.CHATBOT_MODE === 'mock') return [];

  if (vector.length !== env.VECTOR_SIZE) {
    throw new Error(
      `Invalid query embedding dimension: expected ${env.VECTOR_SIZE}, received ${vector.length}`
    );
  }

  const safeLimit = Math.max(1, limit);
  const numCandidates = Math.max(safeLimit * 10, 100);

  const results = await mongoDb()
    .collection<KnowledgeRecord>('knowledge')
    .aggregate<SearchHit>([
      {
        $vectorSearch: {
          index: env.MONGODB_VECTOR_INDEX,
          path: 'embedding',
          queryVector: vector,
          numCandidates,
          limit: safeLimit
        }
      },
      {
        $set: {
          score: { $meta: 'vectorSearchScore' }
        }
      }
    ])
    .toArray();

  return results.map((document) => ({
    ...document,
    score: Number(document.score ?? 0),
    sourceType: 'vector' as const
  }));
}
