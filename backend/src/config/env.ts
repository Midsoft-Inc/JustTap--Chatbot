import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CHATBOT_MODE: z.enum(['mock', 'production']).default('production'),
  PORT: z.coerce.number().default(8080),
  HOST: z.string().default('0.0.0.0'),
  CORS_ORIGIN: z.string().default('*'),

  MONGODB_URI: z.string().default('mongodb://localhost:27017'),
  MONGODB_DB: z.string().default('justtap_chatbot'),
  MONGODB_VECTOR_INDEX: z.string().default('knowledge_vector_index'),

  QDRANT_URL: z.string().url().default('http://localhost:6333'),
  QDRANT_API_KEY: z.string().optional(),
  QDRANT_COLLECTION: z.string().default('justtap_knowledge'),
  VECTOR_SIZE: z.coerce.number().default(384),

  HF_API_TOKEN: z.string().min(1),
  HF_EMBEDDING_MODEL: z.string().default('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2'),
  HF_LLM_MODEL: z.string().default('meta-llama/Llama-3.1-8B-Instruct'),
  HF_RERANKER_MODEL: z.string().optional(),

  TOP_K_VECTOR: z.coerce.number().default(12),
  TOP_K_KEYWORD: z.coerce.number().default(12),
  TOP_K_FINAL: z.coerce.number().default(5),
  MIN_RELEVANCE_SCORE: z.coerce.number().default(0.52),
  TICKET_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.55),

  ADMIN_TOKEN: z.string().optional()
});

export const env = schema.parse(process.env);
