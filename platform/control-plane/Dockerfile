FROM node:24.22.3-alpine3.24@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5

# docker-cli + compose let this container drive the host's Docker daemon through
# the mounted socket. openssl generates each tenant's JWT secret. git is used by
# the "Update all apps" flow to pull the latest code before rebuilding (skipped
# gracefully when STACK_ROOT isn't a git checkout, e.g. local rehearsal).
# bash runs platform/restore-drill.sh for the panel's monthly restore drill.
RUN apk add --no-cache docker-cli docker-cli-compose openssl curl git bash

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js billing.js ./
COPY public ./public

EXPOSE 9000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:9000/healthz || exit 1
# Absolute path: the compose service bind-mounts the repo, and a stray
# working_dir must not change which script runs.
CMD ["node", "/app/server.js"]
