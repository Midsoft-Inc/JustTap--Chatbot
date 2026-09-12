# JustTap Chatbot Backend — Vercel Deployment

This package keeps the chatbot, RAG, LangChain, Hugging Face, MongoDB Atlas, vector-search, ticket, and API application logic unchanged. The deployment hardening only removes the custom DNS override and reuses the MongoDB connection for serverless runtimes.

## 1. Vercel project

- Framework Preset: Fastify
- Root Directory: `backend` (if deploying the repository root, set this to `backend`)
- Node.js: 22.x
- Build Command: `npm run build`
- Start Command: `npm start` (or leave Vercel's Fastify detection enabled)

## 2. Vercel environment variables

Set these for Production (and Preview if needed):

- `NODE_ENV=production`
- `CHATBOT_MODE=production`
- `PORT=8080`
- `HOST=0.0.0.0`
- `CORS_ORIGIN=<your frontend URL>`
- `MONGODB_URI=<MongoDB Atlas driver connection string>`
- `MONGODB_DB=justtap_chatbot`
- `MONGODB_VECTOR_INDEX=knowledge_vector_index`
- `VECTOR_SIZE=384`
- `HF_API_TOKEN=<your Hugging Face token>`
- `HF_EMBEDDING_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`
- `HF_LLM_MODEL=meta-llama/Llama-3.1-8B-Instruct`

Keep secrets in Vercel Environment Variables. Do not commit `.env.local` files.

## 3. MongoDB Atlas — required for Vercel

The previous Vercel runtime log showed a MongoDB TLS connection failure during startup. The code package cannot bypass a MongoDB Atlas connection rejection, so verify Atlas before testing the chatbot:

1. Confirm the Atlas cluster is running.
2. Confirm the MongoDB database user/password are valid.
3. Copy a fresh connection string from Atlas **Connect → Drivers** for Node.js and set it as `MONGODB_URI` in Vercel.
4. URL-encode special characters in the database username/password if required by the connection-string format.
5. In Atlas **Network Access**, allow the Vercel deployment to reach the cluster. For a temporary connectivity test, `0.0.0.0/0` can be used; restrict access afterward when you have a suitable fixed-egress setup.
6. Ensure the user has the required read/write permissions for `justtap_chatbot`.

## 4. Vector search

The existing application uses MongoDB Atlas Vector Search. Keep the configured index name and embedding dimensions consistent with the existing data:

- Index: `knowledge_vector_index`
- Dimensions: `384`
- Similarity: `cosine`

## 5. Deploy

From the repository root:

```bash
cd backend
npm ci
npm run build
npx vercel --prod
```

After deployment, test:

```text
https://<your-backend-domain>/api/v1/health
```

A successful production response should be HTTP 200 and report MongoDB as healthy.

## 6. Frontend

Set the frontend API base URL to the deployed backend URL. Do not change chatbot/RAG logic; only use the deployed API origin in the frontend's deployment environment configuration.
