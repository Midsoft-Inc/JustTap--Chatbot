# =========================
# Stage 1: Build Frontend
# =========================
FROM node:24-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./

RUN npm run build


# =========================
# Stage 2: Build Backend
# =========================
FROM node:24-alpine AS backend-builder

WORKDIR /app/backend

COPY backend/package*.json ./
RUN npm ci

COPY backend/ ./

RUN npm run build


# =========================
# Stage 3: Production
# =========================
FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

# Backend package files
COPY backend/package*.json ./backend/

WORKDIR /app/backend

RUN npm ci --omit=dev

# Backend compiled application
COPY --from=backend-builder /app/backend/dist ./dist

# Frontend production build
COPY --from=frontend-builder /app/frontend/dist /app/frontend-dist

WORKDIR /app/backend

EXPOSE 8080

CMD ["node", "dist/src/server.js"]