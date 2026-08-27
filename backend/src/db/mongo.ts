import { MongoClient, Db } from 'mongodb';
import { env } from '../config/env.js';

let client: MongoClient;
let db: Db;

export async function connectMongo() {
  client = new MongoClient(env.MONGODB_URI);
  await client.connect();
  db = client.db(env.MONGODB_DB);
  await ensureIndexes();
  await ensureVectorSearchIndex();
  return db;
}

export function mongoDb() {
  if (!db) throw new Error('MongoDB is not connected');
  return db;
}

export async function closeMongo() {
  if (client) await client.close();
}

async function ensureIndexes() {
  const knowledge = db.collection('knowledge');
  const conversations = db.collection('conversations');
  const messages = db.collection('messages');
  const tickets = db.collection('tickets');
  const ticketMessages = db.collection('ticket_messages');

  await knowledge.createIndex({ category: 1, sub_service: 1, intent: 1 });
  await knowledge.createIndex({ language: 1 });
  await knowledge.createIndex({ keywords: 1 });
  await conversations.createIndex({ sessionId: 1 }, { unique: true });
  await messages.createIndex({ sessionId: 1, createdAt: 1 });
  await tickets.createIndex({ ticketId: 1 }, { unique: true });
  await tickets.createIndex({ status: 1, createdAt: -1 });
  await tickets.createIndex({ customerReference: 1, createdAt: -1 });
  await ticketMessages.createIndex({ ticketId: 1, createdAt: 1 });
}


/**
 * Create the MongoDB Atlas Vector Search index for the knowledge collection.
 * This only prepares MongoDB for vector storage/search. The existing RAG
 * retrieval path remains unchanged and continues to use its current adapter.
 */
async function ensureVectorSearchIndex() {
  try {
    const knowledge = db.collection('knowledge');
    const indexName = process.env.MONGODB_VECTOR_INDEX || 'knowledge_vector_index';
    const dimensions = Number(process.env.VECTOR_SIZE || 384);

    if (typeof (knowledge as any).createSearchIndex !== 'function') {
      return;
    }

    const indexes = await (knowledge as any).listSearchIndexes().toArray();
    const exists = indexes.some((index: any) => index.name === indexName);

    if (!exists) {
      await (knowledge as any).createSearchIndex({
        name: indexName,
        type: 'vectorSearch',
        definition: {
          fields: [
            {
              type: 'vector',
              path: 'embedding',
              numDimensions: dimensions,
              similarity: 'cosine'
            },
            {
              type: 'filter',
              path: 'language'
            },
            {
              type: 'filter',
              path: 'intent'
            },
            {
              type: 'filter',
              path: 'category'
            },
            {
              type: 'filter',
              path: 'sub_service'
            }
          ]
        }
      });
    }
  } catch (error) {
    // Atlas search-index creation can be unavailable on local MongoDB or on
    // accounts where the feature is not enabled. Database startup must not
    // break the existing chatbot because of this optional index.
    console.warn('[MONGO] Vector Search index setup skipped:', error);
  }
}
