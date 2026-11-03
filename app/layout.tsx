import type React from "react"
import type { Metadata } from "next"
import { preload } from "react-dom"
import { SessionProvider } from "@/components/providers/SessionProvider"
import { Toaster } from "@/components/ui/sonner"
import { GoogleAnalytics } from "@/components/shared/GoogleAnalytics"
import { CaptureGclid } from "@/components/analytics/CaptureGclid"
import { SITE_URL, SITE_BRAND } from "@/lib/constants"
import "./fonts.css"
import "./globals.css"

// Self-hosted (see app/fonts.css for why). The Latin files are preloaded, as next/font did.
const PRELOAD_FONTS = ["lexend-exa-latin", "lexend-deca-latin", "jetbrains-mono-latin"]

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "DJP Athlete — Elite Sports Performance Coaching",
    // The one definition. `lib/funnels/seo.ts` appends the same constant to
    // OG/Twitter titles, which do not pass through this template.
    template: `%s | ${SITE_BRAND}`,
  },
  description:
    "Elite sports performance coaching by Darren J Paul, PhD. Assessment-led, individualized programming for serious athletes — in-person, online, and return-to-performance.",
  openGraph: {
    title: "DJP Athlete — Elite Sports Performance Coaching",
    description:
      "Elite sports performance coaching by Darren J Paul, PhD. Assessment-led, individualized programming for serious athletes — in-person, online, and return-to-performance.",
    type: "website",
    siteName: "DJP Athlete",
    locale: "en_US",
    images: [
      {
        url: "/images/gym-training-01.jpg",
        alt: "DJP Athlete — Elite Sports Performance Coaching",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "DJP Athlete — Elite Sports Performance Coaching",
    description:
      "Elite sports performance coaching by Darren J Paul, PhD. Assessment-led, individualized programming for serious athletes.",
    images: ["/images/gym-training-01.jpg"],
  },
  icons: {
    icon: "/apple-icon.png",
    apple: "/apple-icon.png",
  },
  manifest: "/manifest.json",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  for (const name of PRELOAD_FONTS) preload(`/fonts/${name}.woff2`, { as: "font", type: "font/woff2", crossOrigin: "" })
  return (
    <html lang="en">
      <body className="font-body antialiased">
        <noscript>
          <style>{`[style*="opacity: 0"] { opacity: 1 !important; transform: none !important; }`}</style>
        </noscript>
        <SessionProvider>
          {children}
          <Toaster />
        </SessionProvider>
        <GoogleAnalytics />
        <CaptureGclid />
      </body>
    </html>
  )
}
