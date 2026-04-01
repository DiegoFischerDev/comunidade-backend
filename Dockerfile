# Build
FROM node:20-alpine AS builder

WORKDIR /app

# prisma/ antes de npm ci: o postinstall corre prisma generate e precisa do schema
COPY package.json package-lock.json* ./
COPY prisma ./prisma/
RUN npm ci

COPY . .
RUN npm run build

# Run
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 3001

# Migrações: correr no deploy (ex.: docker compose run --rm … migrate deploy), não aqui —
# em VPS pequenas, migrate no arranque + Node levava a OOM (exit 137).
CMD ["node", "dist/src/main.js"]
