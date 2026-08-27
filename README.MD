
# JustTap Chatbot

Production-oriented full-stack customer-support chatbot for **JustTap**.

The project combines a React/Vite customer chat UI with a Node.js/TypeScript/Fastify backend. The backend uses deterministic intent rules, multilingual normalization, LangChain orchestration, hybrid RAG retrieval, Hugging Face models, MongoDB persistence, optional MongoDB Atlas Vector Search preparation, and Qdrant vector search.

> **Scope:** The chatbot provides information and guidance about JustTap. It does not directly perform customer application actions such as booking, cancellation, payment execution, or provider selection.

---

## 1. What this project does

The chatbot is designed to handle:

- JustTap general information
- Service discovery and service-related questions
- Booking guidance
- Provider guidance
- Pricing questions when supported by the knowledge base
- Payment/support problems and ticket creation
- Account/login/password knowledge questions when present in the knowledge base
- Multilingual input and normalization
- Conversational follow-ups such as:
  - User: `I am on the way and my car has damage`
  - User: `so I want a mechanic`
- Small talk such as greetings, thanks, goodbye, and acknowledgement
- Knowledge-grounded answers instead of unrestricted model answers

### JustTap service catalog

**Home Services**

- Plumber
- Electrician
- Carpenter
- AC Technician
- Painter

**Auto Services**

- Bike Mechanic
- Car Mechanic
- Car Wash

**Domestic Services**

- Maid Service
- Security Guard
- Gardener
- Cleaner

**Technical Services**

- Software Developer
- Web Designer
- Mobile App Developer
- Computer Repair Technician
- Digital Marketing Expert

**Education Services**

- Online Tutor
- Spoken English Trainer
- Computer Trainer
- Coaching Institute

**Business Services**

- Accountant
- Tax Consultant
- CA
- Insurance Agent
- Financial Advisor

The service catalog should remain consistent with the authoritative JustTap knowledge dataset.

---

## 2. High-level architecture

```text
                    ┌──────────────────────┐
                    │ React + Vite Frontend │
                    │ Customer Chat UI      │
                    └──────────┬───────────┘
                               │
                               │ POST /api/v1/chat
                               ▼
                    ┌──────────────────────┐
                    │ Fastify API           │
                    │ Node.js + TypeScript  │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Chat Service          │
                    │ Session/Ticket logic  │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ LangChain             │
                    │ Orchestrator          │
                    └──────────┬───────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
   Language/Normalize     Semantic Chain       Conversation
          │                    │                  Memory
          └────────────────────┼────────────────────┘
                               ▼
                    ┌──────────────────────┐
                    │ Routing               │
                    │ small talk            │
                    │ clarification         │
                    │ support issue         │
                    │ grounded RAG          │
                    └──────────┬───────────┘
                               │
                         grounded RAG
                               ▼
              ┌─────────────────────────────────┐
              │ Hybrid Retrieval                │
              │ MongoDB keyword + Qdrant vector│
              └────────────────┬────────────────┘
                               ▼
                         Reranker stage
                               │
                               ▼
                    Grounded Answer Chain
                               │
                               ▼
                    Hugging Face LLM
                               │
                               ▼
                         Final answer

        Persistence / support:
        MongoDB → conversations, messages, knowledge, tickets
        Qdrant  → vector retrieval collection
```

---

## 3. Request lifecycle

A normal customer message follows this path:

1. Frontend sends `POST /api/v1/chat`.
2. Backend validates the request with Zod.
3. A session ID is created or reused.
4. Language is detected.
5. The message is normalized to English when required.
6. Recent conversation turns are loaded.
7. The semantic chain determines intent, service, entities, confidence, and conversation state.
8. The orchestrator chooses a route:
   - `small_talk`
   - `clarification`
   - `support_issue`
   - `grounded`
9. Grounded requests enter hybrid retrieval.
10. Retrieval results are reranked.
11. The answer chain generates a response using retrieved knowledge.
12. The response is returned in the detected user language.
13. Conversation and support data are persisted when MongoDB is enabled.

The detailed pipeline is documented in [`docs/RAG_AND_LANGCHAIN.md`](docs/RAG_AND_LANGCHAIN.md).

---

## 4. Project structure

```text
JustTap-Chatbot/
├── README.md
├── README_PRODUCTION.md
├── docs/
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── CONFIGURATION.md
│   ├── DEPLOYMENT.md
│   ├── KNOWLEDGE_DATASET.md
│   ├── LOCAL_DEVELOPMENT.md
│   ├── RAG_AND_LANGCHAIN.md
│   ├── SECURITY.md
│   ├── SERVICE_CATALOG.md
│   └── TROUBLESHOOTING.md
├── backend/
│   ├── src/
│   │   ├── config/
│   │   ├── db/
│   │   ├── langchain/
│   │   ├── models/
│   │   ├── routes/
│   │   └── services/
│   ├── scripts/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── package.json
│   └── tsconfig.json
└── frontend/
    ├── src/
    ├── Dockerfile
    ├── nginx.conf
    ├── package.json
    └── vite.config.ts
```

### Backend modules

| Module                                 | Responsibility                                             |
| -------------------------------------- | ---------------------------------------------------------- |
| `src/server.ts`                      | Fastify app, middleware, route registration, startup       |
| `src/routes/chat.ts`                 | Customer chat endpoint and validation                      |
| `src/routes/tickets.ts`              | Ticket and provider-panel support endpoints                |
| `src/routes/health.ts`               | Health endpoint                                            |
| `src/services/chat.ts`               | Chat entry point, ticket creation, persistence integration |
| `src/services/queryUnderstanding.ts` | Deterministic + LLM semantic understanding                 |
| `src/services/language.ts`           | Language detection                                         |
| `src/services/translation.ts`        | Multilingual normalization                                 |
| `src/services/knowledge.ts`          | Knowledge ingestion/search/hybrid retrieval adapter        |
| `src/services/vector.ts`             | Qdrant/vector collection integration                       |
| `src/services/huggingface.ts`        | Hugging Face model calls                                   |
| `src/langchain/orchestrator.ts`      | End-to-end LangChain routing                               |
| `src/langchain/semanticChain.ts`     | Semantic intent/service/entity chain                       |
| `src/langchain/retrieval.ts`         | Retrieval + explicit reranking chain                       |
| `src/langchain/answerChain.ts`       | Grounded final-answer chain                                |
| `src/langchain/memory.ts`            | Conversation memory/state                                  |
| `src/db/mongo.ts`                    | MongoDB connection/indexes/vector-search index preparation |

---

## 5. Main API

### Customer chat

```http
POST /api/v1/chat
Content-Type: application/json
```

Request:

```json
{
  "message": "I need a plumber",
  "sessionId": "test_001",
  "customerReference": "optional-reference"
}
```

Response shape:

```json
{
  "sessionId": "test_001",
  "language": "en",
  "intent": "service_booking",
  "answer": "...",
  "ticketCreated": false,
  "sources": []
}
```

See [`docs/API.md`](docs/API.md) for all endpoints and examples.

---

## 6. Local setup

### Requirements

- Node.js 20+ recommended
- npm
- Docker Desktop for local Qdrant/MongoDB infrastructure where applicable
- A Hugging Face token for model-backed operation
- MongoDB Atlas or MongoDB for persistent mode
- Qdrant for the current vector retrieval path

### Backend

```powershell
cd backend
npm install
```

Create `.env` from the example and add real secrets locally.

Start development mode:

```powershell
npm run dev
```

Build:

```powershell
npm run build
```

Production start:

```powershell
npm start
```

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

The frontend should point to the backend with:

```env
VITE_API_URL=http://127.0.0.1:8080
```

Restart Vite after changing `.env`.

---

## 7. Docker

From `backend/`:

```powershell
docker compose up -d
```

The supplied compose configuration runs the backend and Qdrant. MongoDB is expected to be supplied through the configured MongoDB URI in the current configuration.

Useful commands:

```powershell
docker compose ps
docker compose logs -f justtap-backend
docker compose logs -f qdrant
docker compose down
```

See [`docs/LOCAL_DEVELOPMENT.md`](docs/LOCAL_DEVELOPMENT.md).

---

## 8. Knowledge ingestion

The backend package exposes ingestion/seed scripts:

```bash
npm run ingest -- ./knowledge/your-data.csv
npm run ingest -- ./knowledge/your-data.json
npm run ingest -- ./knowledge/your-document.pdf
npm run seed -- knowledge/justtap_service_qa.json
```

The knowledge record model contains fields such as:

- `id`
- `language`
- `category`
- `sub_service`
- `intent`
- `question`
- `answer`
- `keywords`
- `source`
- `metadata`
- `embedding`

See [`docs/KNOWLEDGE_DATASET.md`](docs/KNOWLEDGE_DATASET.md).

---

## 9. Database design

MongoDB is used for application/chatbot persistence. Current code creates indexes for:

- knowledge by category/sub-service/intent
- knowledge by language
- knowledge by keywords
- conversations by session ID
- messages by session and creation time
- tickets by ticket ID
- tickets by status and creation time
- tickets by customer reference
- ticket messages by ticket and creation time

The MongoDB connection also prepares an Atlas Vector Search index named from `MONGODB_VECTOR_INDEX` when the MongoDB driver/environment supports it.

**Important:** the current RAG retrieval path remains based on the existing retrieval adapter and Qdrant. Preparing MongoDB Atlas Vector Search does not automatically replace that retrieval path.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/RAG_AND_LANGCHAIN.md`](docs/RAG_AND_LANGCHAIN.md).

---

## 10. Support ticket flow

Payment/support problems can be routed into the chatbot's ticket system.

Typical lifecycle:

```text
Customer message
      ↓
Support issue detected
      ↓
Ticket created
      ↓
Provider/support panel sees ticket
      ↓
Claim
      ↓
Reply
      ↓
Resolve
```

The chatbot owns these support records. It does not directly operate the main JustTap application database.

---

## 11. Environment modes

### Mock mode

```env
CHATBOT_MODE=mock
```

The current server intentionally skips MongoDB and Qdrant initialization in this mode.

### Production mode

```env
CHATBOT_MODE=production
```

The server initializes MongoDB and the vector collection during startup.

See [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md).

---

## 12. Production deployment

The recommended deployment split is:

```text
Vercel
  └── React/Vite frontend
          │
          ▼
HTTPS backend URL
  └── Fastify/Node.js backend
          │
          ├── MongoDB Atlas
          ├── Qdrant / Qdrant Cloud
          └── Hugging Face
```

The browser should **never** receive MongoDB, Qdrant, Hugging Face, or admin secrets.

For Vercel, deploy the frontend as a Vite application and set:

```env
VITE_API_URL=https://YOUR-BACKEND-DOMAIN
```

The Fastify backend should be deployed to a Node-capable server/container platform unless a dedicated serverless adapter is intentionally introduced.

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## 13. Testing examples

### Greeting

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8080/api/v1/chat" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"message":"hi","sessionId":"test_greeting_001"}'
```

### Service request

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8080/api/v1/chat" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"message":"I need a plumber","sessionId":"test_plumber_001"}'
```

### Contextual service request

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8080/api/v1/chat" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"message":"I am on the way and my car has damage","sessionId":"test_context_001"}'
```

Then, using the same session:

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8080/api/v1/chat" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"message":"so I want a mechanic","sessionId":"test_context_001"}'
```

More test cases are documented in [`docs/API.md`](docs/API.md) and [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

---

## 14. Security rules

Never commit:

- `backend/.env`
- Hugging Face tokens
- MongoDB credentials/connection strings
- Qdrant API keys
- production admin tokens

Only use placeholders in `.env.example` files.

If a credential is accidentally exposed, rotate it immediately.

See [`docs/SECURITY.md`](docs/SECURITY.md).

---

## 15. Documentation index

- [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system components and data flow
- [`API.md`](docs/API.md) — HTTP endpoints and request/response examples
- [`CONFIGURATION.md`](docs/CONFIGURATION.md) — environment variables and modes
- [`DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Docker, Vercel frontend, backend deployment
- [`KNOWLEDGE_DATASET.md`](docs/KNOWLEDGE_DATASET.md) — knowledge schema and ingestion
- [`LOCAL_DEVELOPMENT.md`](docs/LOCAL_DEVELOPMENT.md) — setup and local workflow
- [`RAG_AND_LANGCHAIN.md`](docs/RAG_AND_LANGCHAIN.md) — semantic, retrieval, reranking, and answer pipeline
- [`SECURITY.md`](docs/SECURITY.md) — secrets and production security
- [`SERVICE_CATALOG.md`](docs/SERVICE_CATALOG.md) — JustTap service catalog
- [`TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) — common failures and diagnostics

---

## 16. Current design principles

1. **Ground answers in JustTap knowledge.**
2. **Use deterministic rules for critical/narrow intents where appropriate.**
3. **Use semantic understanding for natural-language variation.**
4. **Use conversation memory for follow-up references.**
5. **Keep retrieval and answer generation separate.**
6. **Do not expose provider personal/contact information through the chatbot.**
7. **Do not let the LLM invent services, prices, policies, availability, or application actions.**
8. **Keep secrets on the backend only.**
9. **Keep the frontend independent of the database layer.**
10. **Change the retrieval implementation only deliberately; the current RAG adapter is isolated from orchestration.**
