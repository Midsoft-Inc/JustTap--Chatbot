# JustTap Chatbot — Vercel-ready bundle

This bundle contains the existing frontend and backend with deployment-only preparation. The chatbot application logic, RAG/retrieval flow, LangChain modules, MongoDB schema/collections, API routes, and UI behavior are not intentionally rewritten.

## Deployment architecture

- `frontend/` → Vercel frontend project
- `backend/` → Vercel Fastify/Node backend project
- MongoDB Atlas → existing database
- MongoDB Atlas Vector Search → existing `knowledge_vector_index`
- Hugging Face → existing embedding/LLM configuration

## 1. Rotate exposed secrets first

The previously shared Hugging Face token and admin token must be rotated. Never commit real secrets.

## 2. Backend Vercel project

Import the `backend` directory as its own Vercel project.

Set these Environment Variables in Vercel:

```text
NODE_ENV=production
CHATBOT_MODE=production
CORS_ORIGIN=https://YOUR-FRONTEND.vercel.app
MONGODB_URI=<your MongoDB Atlas URI>
MONGODB_DB=justtap_chatbot
MONGODB_VECTOR_INDEX=knowledge_vector_index
VECTOR_SIZE=384
HF_API_TOKEN=<new token>
HF_EMBEDDING_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
HF_LLM_MODEL=meta-llama/Llama-3.1-8B-Instruct
HF_RERANKER_MODEL=<existing model id if used>
TOP_K_VECTOR=12
TOP_K_KEYWORD=12
TOP_K_FINAL=5
MIN_RELEVANCE_SCORE=0.52
TICKET_CONFIDENCE_THRESHOLD=0.55
ADMIN_TOKEN=<new random secret>
```

Deploy with Vercel CLI if desired:

```powershell
cd backend
npm install
npm run build
npm install -g vercel@latest
vercel login
vercel
```

After deployment, test:

```text
https://YOUR-BACKEND.vercel.app/api/v1/health
```

## 3. Frontend Vercel project

Import the `frontend` directory as a second Vercel project.

Set:

```text
VITE_API_URL=https://YOUR-BACKEND.vercel.app
```

Then deploy:

```powershell
cd frontend
npm install
npm run build
vercel
```

## 4. MongoDB Atlas

Keep the existing database and collections. Ensure the Atlas Vector Search index is named:

```text
knowledge_vector_index
```

with 384 dimensions and cosine similarity, matching the existing configuration.

Do not put MongoDB credentials in frontend environment variables.

## 5. Important

Vercel backend deployments do not provide a single permanent outbound IP in the way a VPS with a static egress IP does. Do not assume the Vercel deployment URL is a database IP. Configure MongoDB Atlas network access/security according to the Vercel connectivity option you choose.

## 6. Existing local development

Backend:

```powershell
cd backend
npm install
npm run dev
```

Frontend:

```powershell
cd frontend
npm install
npm run dev
```

Local frontend uses `VITE_API_URL=http://localhost:8080` from `.env`; production uses the Vercel Environment Variable above.
