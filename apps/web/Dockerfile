FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
RUN npm install -g pnpm@9.15.4
COPY . .
RUN pnpm install --frozen-lockfile

FROM deps AS builder
RUN pnpm --filter @gitpulse/web build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
