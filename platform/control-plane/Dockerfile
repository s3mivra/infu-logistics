FROM node:20-alpine

# docker-cli + compose let this container drive the host's Docker daemon through
# the mounted socket. openssl generates each tenant's JWT secret. git is used by
# the "Update all apps" flow to pull the latest code before rebuilding (skipped
# gracefully when STACK_ROOT isn't a git checkout, e.g. local rehearsal).
RUN apk add --no-cache docker-cli docker-cli-compose openssl curl git

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY public ./public

EXPOSE 9000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:9000/healthz || exit 1
# Absolute path: the compose service bind-mounts the repo, and a stray
# working_dir must not change which script runs.
CMD ["node", "/app/server.js"]
