# ── Stage 1: Install runtime deps ─────────────────────────────────────
# We need Node here to run `npm ci` but nowhere else — the final image
# only ships the plugin source + resolved node_modules, never executes
# Node itself (it's an init container that only runs sh + cp).
FROM node:20-alpine AS builder
WORKDIR /plugin
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# ── Stage 2: Minimal file bundle (alpine only, no Node) ───────────────
# Leonarr is an Oscarr plugin — the image doesn't run a long-lived
# service. It behaves as an init container: on start, it syncs its
# files into a shared volume that Oscarr mounts as its plugins
# directory, then exits cleanly. Node is never invoked here, so we
# strip the full `node:20-alpine` (~140 MB) down to bare Alpine.
FROM alpine:3.20
WORKDIR /plugin
RUN addgroup -S leonarr && adduser -S leonarr -G leonarr

COPY --from=builder --chown=leonarr:leonarr /plugin/node_modules ./node_modules
COPY --chown=leonarr:leonarr manifest.json package.json index.js ./
COPY --chown=leonarr:leonarr src ./src

RUN <<'EOF' cat > /install.sh
#!/bin/sh
set -eu
TARGET="${LEONARR_TARGET:-/plugins-out/leonarr}"
echo "[Leonarr] Syncing plugin files → $TARGET"
mkdir -p "$TARGET"
rm -rf "$TARGET"/* "$TARGET"/.[!.]* 2>/dev/null || true
cp -rf /plugin/. "$TARGET/"
echo "[Leonarr] Synced $(find "$TARGET" -type f | wc -l) files. Plugin ready."
EOF
RUN chmod +x /install.sh

USER leonarr
ENTRYPOINT ["/install.sh"]
