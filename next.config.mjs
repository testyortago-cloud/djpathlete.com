/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep gRPC-based Google SDKs unbundled on the server. Webpack bundling
  // produces duplicate copies of @grpc/grpc-js, which breaks internal
  // `instanceof ChannelCredentials` checks and surfaces in production as
  // "Channel credentials must be a ChannelCredentials object" when calling
  // google-ads-api on Vercel.
  serverExternalPackages: [
    "google-ads-api",
    "google-ads-node",
    "google-gax",
    "@grpc/grpc-js",
    "@grpc/proto-loader",
    "@google-analytics/data",
    "@google-cloud/firestore",
    "firebase-admin",
    // sharp ships a native binary; bundling it breaks the quote-card JPEG
    // (Instagram) render path. Keep it loaded as a native node module.
    "sharp",
  ],
  experimental: {
    optimizePackageImports: ["lucide-react"],
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
  // Force blocking metadata render for SEO crawlers and audit tools so
  // <title> and <meta> land inside <head> in the static HTML response,
  // not streamed into the body via React 19 float. Real browsers still
  // get the streamed (non-blocking) rendering path.
  htmlLimitedBots:
    /Googlebot|Mediapartners-Google|AdsBot-Google|Storebot-Google|Bingbot|BingPreview|YandexBot|DuckDuckBot|Baiduspider|Sogou|Exabot|facebot|facebookexternalhit|LinkedInBot|TwitterBot|Twitterbot|Slackbot|Discordbot|TelegramBot|WhatsApp|Pinterestbot|Applebot|Screaming Frog|SiteAuditBot|AhrefsBot|AhrefsSiteAudit|SemrushBot|Sitebulb|MJ12bot|DotBot|rogerbot|SEOkicks|MegaIndex|seokicks|seznambot|petalbot|PetalBot/i,
  images: {
    // Drop 3840 (4K) from default device sizes. Largest hero source is 2000px
    // wide, so 3840 srcset entries upscale and bloat. Keeps the optimizer's
    // largest variant at 1920px, well under 100 KB after q=75.
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    remotePatterns: [
      { hostname: "images.pexels.com" },
      { hostname: "images.unsplash.com" },
      { hostname: "epzuvzkokzqtzomeyoha.supabase.co" },
    ],
  },
  async redirects() {
    return [
      // Legacy URL — team-videos was renamed to team-media when the surface
      // expanded to cover both videos and image-set submissions. Keeps old
      // email links and bookmarks working.
      {
        source: "/admin/team-videos",
        destination: "/admin/team-media",
        permanent: true,
      },
      {
        source: "/admin/team-videos/:path*",
        destination: "/admin/team-media/:path*",
        permanent: true,
      },
      // Athletes consolidation — the four per-stage pages were merged into a
      // single /athletes summary. 301 forwards the link equity and ensures the
      // tab "only lands in 1 page" per product direction.
      {
        source: "/athletes/:type(professional|collegiate|youth|return-to-sport)",
        destination: "/athletes",
        permanent: true,
      },
      // Resources retired — the topics that lived here are being distributed
      // across other pages. 301 to /blog so any external links + indexed URLs
      // keep their link equity and stay deep-linked into editorial content.
      {
        source: "/resources",
        destination: "/blog",
        permanent: true,
      },
      {
        source: "/resources/:path*",
        destination: "/blog",
        permanent: true,
      },
      // Apex host canonicalisation. The site canonical is the www host
      // (SITE_URL in lib/constants.ts); a permanent redirect from the apex
      // collapses every duplicate-content signal onto the www variant. Vercel
      // may also enforce this at the domain layer when www is set as primary
      // — this redirect is idempotent with that and survives reconfiguration.
      {
        source: "/:path*",
        has: [{ type: "host", value: "darrenjpaul.com" }],
        destination: "https://www.darrenjpaul.com/:path*",
        permanent: true,
      },
    ]
  },
  async headers() {
    // Content Security Policy. 'unsafe-inline' on script/style is required by
    // Next.js's hydration scripts, the inline GA snippet, and Tailwind inline
    // style attributes. External hosts cover GA, Stripe (checkout + webhooks),
    // Supabase (REST + realtime + storage), Firebase (Firestore, RTDB
    // websocket, Auth, Installations, Storage), and our image CDNs.
    //
    // Firebase notes:
    //   - firestore.googleapis.com — Firestore listeners (Listen channel).
    //   - *.firebaseio.com + wss:// — RTDB realtime websocket subscriptions.
    //     Required for the floating job dock listener.
    //   - *.firebasedatabase.app + wss:// — newer regional RTDB host format.
    //   - identitytoolkit.googleapis.com + securetoken.googleapis.com — Auth.
    //   - firebaseinstallations.googleapis.com — Firebase Installations
    //     handshake (runs once per browser when SDK initializes).
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://*.google-analytics.com https://js.stripe.com https://googleads.g.doubleclick.net https://www.googleadservices.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      // fonts.gstatic.com: the Remotion <Player> reel-editor preview loads Lexend
      // Exa 800 via @remotion/google-fonts (the SAME font the render worker bakes
      // in), which injects an @font-face pointing at the gstatic woff2. Without
      // this the preview falls back to a system font and drifts from the render.
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.google-analytics.com https://www.googletagmanager.com https://www.google.com https://*.googleadservices.com https://stats.g.doubleclick.net https://api.stripe.com https://storage.googleapis.com https://*.firebasestorage.app https://firebasestorage.googleapis.com https://firestore.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firebasedatabase.app wss://*.firebasedatabase.app https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebaseinstallations.googleapis.com",
      "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://www.youtube.com https://www.youtube-nocookie.com",
      // data:: @remotion/player primes audio playback with a tiny silent
      // data:audio/mp3 URI (the reel-editor preview's Audio/Video layers); without
      // data: the browser blocks it and audio preview is silent.
      "media-src 'self' blob: data: https:",
      "worker-src 'self' blob:",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join("; ")

    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ]
  },
}

export default nextConfig
