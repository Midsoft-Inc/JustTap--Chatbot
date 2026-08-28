# =========================
# Frontend build
# =========================
FROM node:22-alpine AS frontend-build

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build


# =========================
# Backend build
# =========================
FROM node:22-alpine AS backend-build

WORKDIR /app/backend

COPY backend/package*.json ./
RUN npm ci

COPY backend/tsconfig.json ./
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY backend/knowledge ./knowledge

RUN npm run build


# =========================
# Production
# =========================
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

# Backend dependencies
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Backend compiled files
COPY --from=backend-build /app/backend/dist ./dist

# Knowledge files
COPY --from=backend-build /app/backend/knowledge ./knowledge

# Frontend compiled files
COPY --from=frontend-build /app/frontend/dist ./frontend-dist

EXPOSE 8080

CMD ["node", "dist/src/server.js"]