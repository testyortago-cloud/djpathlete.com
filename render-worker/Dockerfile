# render-worker/Dockerfile
# Cloud Run Job image for the Captioned Cut render worker. Runs headless
# Chromium (via Remotion) so it needs the Chromium runtime libs + a brand font.
FROM node:22-bookworm-slim

# Chromium runtime deps for Remotion's headless render + fontconfig for captions.
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-liberation libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2 ca-certificates \
    fontconfig curl \
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
