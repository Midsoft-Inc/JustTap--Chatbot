# JustTap Chatbot Backend

Production-oriented Node.js + TypeScript backend for the standalone JustTap information/support chatbot.

## Scope

- Information and guidance only for normal application actions.
- Multilingual response using detected user language.
- CSV / JSON / PDF ingestion.
- Hugging Face multilingual embeddings and LLM.
- MongoDB as the chatbot's primary database.
- Qdrant as the vector search engine for embeddings.
- Hybrid keyword + vector retrieval.
- Reranking-ready retrieval layer.
- Strict relevance/domain guard.
- Chat/session/message persistence.
- Chatbot-owned support tickets and support APIs.
- 24-hour ticket SLA metadata.
- No access to the JustTap application database.
- No booking/payment/cancellation/rescheduling/provider-selection APIs.
- No LangChain.

## Architecture

```text
Frontend
   |
   | POST /api/v1/chat
   v
Node.js + TypeScript
   |
   +-- Language Detection
   +-- Intent Detection
   +-- Entity/Keyword Processing
   +-- Hybrid Retrieval
   |     +-- MongoDB keyword search
   |     +-- Qdrant vector search
   +-- Relevance Guard
   +-- Hugging Face LLM
   +-- Conversation Store (MongoDB)
   +-- Ticket Service (MongoDB)
   |
   +--> Answer
   |
   +--> Genuine unresolved JustTap issue
            |
            v
       Chatbot Ticket DB
            |
            v
       Support Panel
```

## Important boundary

The actual JustTap application is separate. The chatbot does not directly access its DB or perform normal application actions.

For provider-area requests, the chatbot gives neutral guidance to search in the JustTap application and does not choose/expose individual provider contacts.

## Setup

1. Copy `.env.example` to `.env`.
2. Set `HF_API_TOKEN`.
3. Configure MongoDB and Qdrant.
4. Install dependencies:

```bash
npm install
```

5. Start local infrastructure:

```bash
docker compose up -d mongo qdrant
```

6. Start the API:

```bash
npm run dev
```

## Ingest knowledge

CSV:

```bash
npm run ingest -- ./knowledge/your-data.csv
```

JSON:

```bash
npm run ingest -- ./knowledge/your-data.json
```

PDF:

```bash
npm run ingest -- ./knowledge/your-document.pdf
```

The ingestion pipeline writes normalized knowledge to MongoDB and embeddings to Qdrant.

## Seed the generated service Q&A dataset

Copy the generated dataset into `knowledge/` and run:

```bash
npm run seed -- knowledge/justtap_service_qa.json
```

## Frontend integration

### Chat request

```http
POST /api/v1/chat
Content-Type: application/json
```

```json
{
  "message": "How can I book a plumber?",
  "sessionId": "optional-session-id",
  "customerReference": "optional-customer-reference"
}
```

### Chat response

```json
{
  "sessionId": "...",
  "language": "en",
  "intent": "how_to_book",
  "answer": "...",
  "ticketCreated": false,
  "sources": []
}
```

### Ticket endpoints

```text
GET /api/v1/tickets
GET /api/v1/tickets/:ticketId
```

Ticket creation is controlled by the chatbot decision layer. A ticket is created only for a genuine JustTap-related issue that cannot be resolved from the available knowledge.

## Production notes

- Put the API behind HTTPS/reverse proxy.
- Use MongoDB Atlas or a secured MongoDB deployment.
- Use Qdrant Cloud or secured Qdrant.
- Store secrets only in environment/secret management.
- Add authentication for customer sessions and support agents before production.
- Do not expose source scores to customers unless needed by the UI.
- Add a real multilingual reranker if required; the retrieval interface is already isolated for this.
- Add observability, audit logs, backups, and SLA escalation workers before production launch.
