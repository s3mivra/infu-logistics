FROM node:24.22.3-alpine3.24@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:24.22.3-alpine3.24@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
WORKDIR /app
# The business clock. lib/timezone.js also pins it in code; tzdata makes the
# zone resolvable at the OS level too, and the server refuses to start in
# production if its local time does not match the business zone.
RUN apk add --no-cache tzdata
ENV NODE_ENV=production TZ=Asia/Manila
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY server.js ./
COPY lib ./lib
COPY models ./models
# server.js imports 18 modules from ./features — without this the container
# crashes on boot with ERR_MODULE_NOT_FOUND.
COPY features ./features
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
EXPOSE 5002
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD wget -qO- http://localhost:5002/health || exit 1
CMD ["node", "server.js"]
