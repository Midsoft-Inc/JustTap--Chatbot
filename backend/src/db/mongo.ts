import { MongoClient, Db } from 'mongodb';
import { env } from '../config/env.js';

// Keep the MongoDB client alive between Vercel function invocations when the
// runtime is reused. This avoids opening a new connection and recreating
// indexes on every request while preserving the existing application logic.
let client: MongoClient | null = null;
let db: Db | null = null;
let connectPromise: Promise<Db> | null = null;

export async function connectMongo() {
  if (db) {
    return db;
  }

  if (connectPromise) {
    return connectPromise;
  }

  connectPromise = (async () => {
    const nextClient = new MongoClient(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000
    });

    await nextClient.connect();

    const nextDb = nextClient.db(env.MONGODB_DB);
    client = nextClient;
    db = nextDb;

    await ensureIndexes();
    await ensureVectorSearchIndex();

    return nextDb;
  })();

  try {
    return await connectPromise;
  } catch (error) {
    // Do not leave a failed client as the cached connection.
    client = null;
    db = null;
    throw error;
  } finally {
    connectPromise = null;
  }
}

export function mongoDb() {
  if (!db) {
    throw new Error('MongoDB is not connected');
  }
  return db;
}

export async function closeMongo() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

async function ensureIndexes() {
  const knowledge = mongoDb().collection('knowledge');
  const conversations = mongoDb().collection('conversations');
  const messages = mongoDb().collection('messages');
  const tickets = mongoDb().collection('tickets');
  const ticketMessages = mongoDb().collection('ticket_messages');
  const chatbotCache = mongoDb().collection('chatbot_cache');

  await knowledge.createIndex({ category: 1, sub_service: 1, intent: 1 });
  await knowledge.createIndex({ language: 1 });
  await knowledge.createIndex({ keywords: 1 });
  await conversations.createIndex({ sessionId: 1 }, { unique: true });
  await messages.createIndex({ sessionId: 1, createdAt: 1 });
  await tickets.createIndex({ ticketId: 1 }, { unique: true });
  await tickets.createIndex({ status: 1, createdAt: -1 });
  await tickets.createIndex({ customerReference: 1, createdAt: -1 });
  await ticketMessages.createIndex({ ticketId: 1, createdAt: 1 });
  await chatbotCache.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

async function ensureVectorSearchIndex() {
  try {
    const knowledge = mongoDb().collection('knowledge');
    const indexName =
      process.env.MONGODB_VECTOR_INDEX || 'knowledge_vector_index';
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
            { type: 'filter', path: 'language' },
            { type: 'filter', path: 'intent' },
            { type: 'filter', path: 'category' },
            { type: 'filter', path: 'sub_service' }
          ]
        }
      });
    }
  } catch (error) {
    console.warn('[MONGO] Vector Search index setup skipped:', error);
  }
}
