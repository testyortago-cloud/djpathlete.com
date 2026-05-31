# render-worker/Dockerfile
# Cloud Run Job image for the Captioned Cut render worker. Runs headless
# Chromium (via Remotion) so it needs the Chromium runtime libs + a brand font.
FROM node:22-bookworm-slim

# Complete Chrome-headless-shell runtime dependency set for Debian bookworm.
# The earlier hand-curated list (Remotion's "headline" packages only) was missing
# transitive X11/expat/glib libs that node:22-bookworm-slim strips, causing
# "Failed to launch browser" at render time. This is Puppeteer's published
# complete list — the proven superset — plus fontconfig + the brand font.
# NOTE: libasound2 (NOT libasound2t64) is correct on bookworm/Debian 12.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl fontconfig fonts-liberation \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 \
    libdbus-1-3 libdrm2 libexpat1 libfontconfig1 libgbm1 libgcc-s1 \
    libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 \
    libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 \
    libxdamage1 libxext6 libxfixes3 libxi6 libxkbcommon0 libxrandr2 \
    libxrender1 libxshmfence1 libxss1 libxtst6 \
  && rm -rf /var/lib/apt/lists/*

# Install Lexend Exa (OFL) so burned-in captions match the brand heading font.
# Variable font; fontconfig/Chromium resolve the default weight, and the
# composition requests weight 800.
RUN mkdir -p /usr/share/fonts/truetype/lexendexa \
  && curl -fsSL "https://github.com/google/fonts/raw/main/ofl/lexendexa/LexendExa%5Bwght%5D.ttf" \
     -o /usr/share/fonts/truetype/lexendexa/LexendExa.ttf \
  && fc-cache -f

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Remotion downloads its own Chromium ("chrome headless shell") on first use;
# pre-fetch at build time so the job starts fast. Uses @remotion/renderer's
# programmatic ensureBrowser (no @remotion/cli needed in the image).
RUN node -e "import('@remotion/renderer').then(m => m.ensureBrowser()).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); })"

CMD ["node", "dist/index.js"]
