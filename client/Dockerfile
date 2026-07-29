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
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://localhost/ || exit 1
