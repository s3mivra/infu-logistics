FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# Vite inlines import.meta.env.VITE_* at BUILD time, so these must be present
# before `npm run build` — setting them at runtime on the nginx container does
# nothing. Compose passes them in as build args from the repo-root .env.
# Anything missing here silently falls back to the hardcoded dev defaults
# (VITE_API_URL -> a LAN IP, VITE_BUSINESS_TYPE -> "fb").
ARG VITE_API_URL
ARG VITE_BUSINESS_TYPE
ARG VITE_BUSINESS_NAME
ARG VITE_FRONTEND_URL
ARG VITE_THEME
ARG VITE_FB_LINK
ARG VITE_BILLING_NAME
ARG VITE_BILLING_ADDRESS1
ARG VITE_BILLING_ADDRESS2
ARG VITE_BILLING_PHONE
ARG VITE_BILLING_EMAIL
ARG VITE_BILLING_BANK
ARG VITE_BILLING_ACCOUNT_NAME
ARG VITE_BILLING_ACCOUNT_NO
ENV VITE_API_URL=$VITE_API_URL \
    VITE_BUSINESS_TYPE=$VITE_BUSINESS_TYPE \
    VITE_BUSINESS_NAME=$VITE_BUSINESS_NAME \
    VITE_FRONTEND_URL=$VITE_FRONTEND_URL \
    VITE_THEME=$VITE_THEME \
    VITE_FB_LINK=$VITE_FB_LINK \
    VITE_BILLING_NAME=$VITE_BILLING_NAME \
    VITE_BILLING_ADDRESS1=$VITE_BILLING_ADDRESS1 \
    VITE_BILLING_ADDRESS2=$VITE_BILLING_ADDRESS2 \
    VITE_BILLING_PHONE=$VITE_BILLING_PHONE \
    VITE_BILLING_EMAIL=$VITE_BILLING_EMAIL \
    VITE_BILLING_BANK=$VITE_BILLING_BANK \
    VITE_BILLING_ACCOUNT_NAME=$VITE_BILLING_ACCOUNT_NAME \
    VITE_BILLING_ACCOUNT_NO=$VITE_BILLING_ACCOUNT_NO

# Fail loudly rather than shipping a bundle built for the wrong business type.
RUN test -n "$VITE_BUSINESS_TYPE" || (echo "ERROR: VITE_BUSINESS_TYPE build arg is required" && exit 1)
RUN npm run build

FROM nginx:1.27-alpine
# Which backend this nginx proxies to. Defaults to the compose service name for
# single-tenant deploys; the control plane overrides it with "<slug>-api" so a
# shared docker network can't resolve one tenant's nginx to another's backend.
ARG API_HOST=api
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN sed -i "s/__API_HOST__/${API_HOST}/g" /etc/nginx/conf.d/default.conf \
 && grep -q '__API_HOST__' /etc/nginx/conf.d/default.conf && exit 1 || true
EXPOSE 80
# 127.0.0.1, NOT localhost: inside the container localhost resolves to ::1 first
# and nginx listens on IPv4 only, so the check never passed and the container sat
# in "health: starting" forever.
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1/ || exit 1
