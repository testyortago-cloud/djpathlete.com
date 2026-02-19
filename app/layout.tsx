import type React from "react"
import type { Metadata } from "next"
import { Lexend_Exa, Lexend_Deca, JetBrains_Mono } from "next/font/google"
import { SessionProvider } from "@/components/providers/SessionProvider"
import { Toaster } from "@/components/ui/sonner"
import "./globals.css"

const lexendExa = Lexend_Exa({
  subsets: ["latin"],
  variable: "--font-lexend-exa",
  weight: ["600", "700"],
})

const lexendDeca = Lexend_Deca({
  subsets: ["latin"],
  variable: "--font-lexend-deca",
  weight: ["300", "400", "500"],
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  weight: ["400"],
})

export const metadata: Metadata = {
  metadataBase: new URL("https://djpathlete.com"),
  title: {
    default: "DJP Athlete - Elite Sports Coaching & Athletic Performance",
    template: "%s | DJP Athlete",
  },
  description:
    "DJP Athlete provides elite sports coaching and athletic performance training. Personalized training plans, performance tracking, video analysis, and nutrition guidance — built for athletes at every level.",
  keywords: [
    "sports coaching",
    "athletic performance",
    "personal training",
    "performance tracking",
    "video analysis",
    "nutrition coaching",
    "strength and conditioning",
    "youth athletics",
    "sports training programs",
    "elite coaching",
  ],
  openGraph: {
    title: "DJP Athlete - Elite Sports Coaching & Athletic Performance",
    description:
      "Personalized coaching and performance training for athletes at every level. Training plans, video analysis, and nutrition guidance in one platform.",
    type: "website",
    siteName: "DJP Athlete",
    locale: "en_US",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "DJP Athlete — Elite Sports Coaching & Athletic Performance",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "DJP Athlete - Elite Sports Coaching & Athletic Performance",
    description:
      "Personalized coaching and performance training for athletes at every level. Training plans, video analysis, and nutrition guidance in one platform.",
    images: ["/og-image.png"],
  },
  icons: {
    icon: "/favicon.ico",
  },
  manifest: "/manifest.json",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${lexendDeca.variable} ${lexendExa.variable} ${jetbrainsMono.variable} font-body antialiased`}>
        <SessionProvider>
          {children}
          <Toaster />
        </SessionProvider>
      </body>
    </html>
  )
}
