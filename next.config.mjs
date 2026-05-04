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
  images: {
    remotePatterns: [
      { hostname: "images.pexels.com" },
      { hostname: "images.unsplash.com" },
      { hostname: "epzuvzkokzqtzomeyoha.supabase.co" },
    ],
  },
  async headers() {
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
