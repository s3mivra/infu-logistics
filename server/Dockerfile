FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY server.js ./
COPY lib ./lib
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
EXPOSE 5002
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:5002/health || exit 1
CMD ["node", "server.js"]
