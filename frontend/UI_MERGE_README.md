# JustTap Frontend UI Merge

This release uses the NEW frontend UI source while preserving the OLD
frontend/backend API contract.

Changed:
- frontend/src/main.tsx -> new UI
- frontend/src/styles.css -> new UI
- Chat request is explicitly connected to the existing backend endpoint:
  /api/v1/chat
- Default development API remains http://localhost:8080
- Existing support API paths remain unchanged:
  /api/support/leads
  /api/support/tickets
  /api/support/customers
- New UI ticket notice accepts the existing backend's ticketCreated field.

Not changed:
- backend source code
- backend routes
- backend server
- RAG/intent/query-understanding logic
- database/vector configuration
- existing API routes
- provider/support API paths

Run:
  npm install
  npm run dev

The backend must be running on the existing API URL (default:
http://localhost:8080), or set VITE_API_URL to the existing backend origin.
