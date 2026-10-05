# Runtime-only image. The bundle is built by the `build:dist` CI job and copied
# in as an artifact; this image is nginx plus static files, nothing else.
#
# It used to be a multi-stage build that ran `pnpm install` inside kaniko.
# kaniko has no BuildKit cache mounts, so every build linked all ~410 packages
# into an overlayfs node_modules from a completely cold store. Measured on
# pipeline 11072 (2026-08-14): that install took 54m50s — one package alone
# stalled for 18.5 minutes — and the snapshot after it ran a further 28 minutes
# before the 90-minute job timeout killed the build. The identical install on an
# ordinary runner, in this repo's own `test` job, takes about 4 minutes.
# The filesystem was the cost, not the work, so the work moved out of kaniko.
#
# Build locally with:
#   pnpm install && pnpm build && docker build -t cloistr-space .
FROM nginxinc/nginx-unprivileged:alpine

# Fails loudly if dist/ is absent, which is the behaviour we want — a missing
# bundle must never produce an image that serves an empty directory.
COPY dist /usr/share/nginx/html

# Rendered to /etc/nginx/conf.d/default.conf at container start by the base
# image's envsubst step, which is what fills in /config.js.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Production values as defaults: a deployment that sets nothing IS production,
# structurally. Staging overrides these per environment at deploy time.
# NGINX_ENVSUBST_FILTER is not optional: without it envsubst also replaces
# nginx's own variables such as $uri.
ENV CLOISTR_RELAY_URL=wss://relay.cloistr.xyz \
    CLOISTR_SIGNER_URL=https://signer.cloistr.xyz \
    CLOISTR_BLOSSOM_URL=https://files.cloistr.xyz \
    CLOISTR_DISCOVERY_URL=https://discover.cloistr.xyz \
    CLOISTR_APP_URL=https://space.cloistr.xyz \
    CLOISTR_STASH_URL=https://stash.cloistr.xyz \
    CLOISTR_TASKS_URL=https://tasks.cloistr.xyz \
    CLOISTR_DOCS_URL=https://docs.cloistr.xyz \
    CLOISTR_DOCS_API_URL=https://docs-api.cloistr.xyz \
    CLOISTR_ENVIRONMENT=production \
    NGINX_ENVSUBST_FILTER=^CLOISTR_

EXPOSE 8080
