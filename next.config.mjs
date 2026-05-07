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
  async headers() {
    // Content Security Policy. 'unsafe-inline' on script/style is required by
    // Next.js's hydration scripts, the inline GA snippet, and Tailwind inline
    // style attributes. External hosts cover GA, Stripe (checkout + webhooks),
    // Supabase (REST + realtime + storage), and our image CDNs.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://*.google-analytics.com https://js.stripe.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.google-analytics.com https://www.googletagmanager.com https://api.stripe.com https://storage.googleapis.com https://*.firebasestorage.app",
      "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
      "media-src 'self' blob: https:",
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
