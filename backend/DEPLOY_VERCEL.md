# JustTap Chatbot Backend — Vercel Deployment

This package keeps the existing chatbot application logic, RAG/retrieval flow, MongoDB schema/collections, LangChain modules, and API routes unchanged. The deployment preparation is limited to runtime/configuration files.

## 1. Secrets

Do **not** commit `.env` or real tokens. Rotate any Hugging Face token or admin token that has been exposed.

Configure the production variables in Vercel Project Settings → Environment Variables using `.env.example` as the list of names.

Required production values:

- `NODE_ENV=production`
- `CHATBOT_MODE=production`
- `CORS_ORIGIN=*` initially; replace with your Vercel frontend origin when known
- `MONGODB_URI=<MongoDB Atlas URI>`
- `MONGODB_DB=justtap_chatbot`
- `MONGODB_VECTOR_INDEX=knowledge_vector_index`
- `VECTOR_SIZE=384`
- `HF_API_TOKEN=<new Hugging Face token>`
- `HF_EMBEDDING_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`
- `HF_LLM_MODEL=meta-llama/Llama-3.1-8B-Instruct`
- `HF_RERANKER_MODEL=<your existing model id, if used>`
- `TOP_K_VECTOR=12`
- `TOP_K_KEYWORD=12`
- `TOP_K_FINAL=5`
- `MIN_RELEVANCE_SCORE=0.52`
- `TICKET_CONFIDENCE_THRESHOLD=0.55`
- `ADMIN_TOKEN=<new random secret>`

## 2. MongoDB Atlas

Create/keep the `justtap_chatbot` database and ensure the `knowledge` collection contains the embeddings used by the existing RAG flow.

The configured vector index name is `knowledge_vector_index` and the vector dimension is `384`.

For the first deployment, use MongoDB Atlas Network Access to allow the deployment to connect. For production, prefer the narrowest network/security configuration available for your chosen Vercel setup rather than exposing the database unnecessarily.

## 3. Deploy

From this backend directory:

```powershell
npm install
npm run build
npm run dev
```

For Vercel CLI:

```powershell
npm install -g vercel@latest
vercel login
vercel
```

When prompted, select/create the Vercel project and deploy this backend directory as its project root.

Vercel currently supports Fastify with zero configuration and detects `src/server.ts`. The existing `src/server.ts` calls `listen()` as required by the current Vercel Fastify/Node backend deployment model.

## 4. Verify

After deployment, open:

```text
https://YOUR-BACKEND.vercel.app/api/v1/health
```

A successful response should contain:

```json
{
  "status": "ok",
  "service": "justtap-chatbot",
  "environment": "production"
}
```

## 5. Connect the existing frontend

Set the frontend production environment variable to the deployed backend URL:

```env
VITE_API_URL=https://YOUR-BACKEND.vercel.app
```

Then redeploy the frontend on Vercel.

## 6. Do not change the application logic

Do not replace the RAG, LangChain modules, MongoDB collections, retrieval thresholds, or chatbot routes just for deployment. This package is intended to run the existing backend as-is with production environment variables.
