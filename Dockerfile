# Multi-stage production container build for K-Delta
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Create unprivileged user for security
RUN addgroup -S nodejs && adduser -S kdelta -G nodejs

COPY --from=build /app/node_modules ./node_modules
COPY . .

# Set strict permissions
RUN chown -R kdelta:nodejs /app
USER kdelta

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/market/status || exit 1

CMD ["node", "server.js"]
