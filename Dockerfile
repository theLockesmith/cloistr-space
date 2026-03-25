FROM node:22-alpine AS builder

WORKDIR /app

# Build arg for npm registry auth (for private @cloistr packages)
ARG NPM_TOKEN

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install dependencies with registry auth
COPY package.json pnpm-lock.yaml* .npmrc ./
RUN echo "//git.coldforge.xyz/api/v4/projects/44/packages/npm/:_authToken=${NPM_TOKEN}" >> .npmrc && \
    pnpm install --frozen-lockfile && \
    rm -f .npmrc

# Copy source and build
COPY . .
RUN pnpm build

# Production image
FROM nginx:alpine

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
