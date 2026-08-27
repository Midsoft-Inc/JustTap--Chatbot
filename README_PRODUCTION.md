# JustTap Production Full-Stack Integration

This package connects the existing Customer Chat + Provider Support Panel to the
existing Fastify chatbot backend.

## Architecture

Browser
  -> VITE_API_URL
  -> Fastify backend
  -> MongoDB + Qdrant + Hugging Face

The browser MUST NOT connect directly to MongoDB.

## Included

- frontend: existing UI, unchanged visually
- backend: existing chatbot backend
- provider-panel compatibility routes:
  - GET /api/support/tickets
  - POST /api/support/tickets/:ticketId/claim
  - PATCH /api/support/tickets/:ticketId/resolve
  - POST /api/support/tickets/:ticketId/reply
  - GET /api/support/customers
- production environment templates with placeholders only

## Local testing

Backend:
  cd backend
  npm ci
  npm run build
  npm run dev

Frontend:
  cd frontend
  npm ci
  npm run build
  npm run dev

For local frontend:
  VITE_API_URL=http://localhost:8080

Provider Panel:
  save the backend ADMIN_TOKEN in Provider -> Settings.

## Test ticket flow

1. Send from Customer Chat:
   "mera payment rukh gaya hai"

2. Confirm:
   intent = payment_problem
   ticketCreated = true
   ticketId = TKT-...

3. Open Provider Panel -> Unassigned.
   The ticket should appear there.

4. Claim -> My Tickets.

5. Reply -> customer support message is stored.

6. Resolve -> status becomes resolved.

7. "yes" from the customer must not create another ticket.

## Production database

Do NOT connect the frontend directly to MongoDB.

After local/integration testing passes:

1. Set backend CHATBOT_MODE=production.
2. Put the real MONGODB_URI, MONGODB_DB, QDRANT credentials,
   HF_API_TOKEN and ADMIN_TOKEN only on the backend server.
3. Set backend CORS_ORIGIN to the real frontend origin.
4. Set frontend VITE_API_URL to the deployed backend URL.
5. Build frontend again and deploy the static frontend.
6. Deploy backend separately.

No real production credentials are included in this package.
