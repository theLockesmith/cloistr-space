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

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
