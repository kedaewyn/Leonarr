FROM node:20-alpine AS builder
WORKDIR /plugin
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund
FROM node:20-alpine
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
