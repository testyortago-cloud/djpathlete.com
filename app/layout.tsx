import type React from "react"
import type { Metadata } from "next"
import { Lexend_Exa, Lexend_Deca, JetBrains_Mono } from "next/font/google"
import { SessionProvider } from "@/components/providers/SessionProvider"
import { Toaster } from "@/components/ui/sonner"
import { GoogleAnalytics } from "@/components/shared/GoogleAnalytics"
import { SITE_URL } from "@/lib/constants"
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
  metadataBase: new URL(SITE_URL),
  title: {
    default: "DJP Athlete — Elite Sports Performance Coaching",
    template: "%s | DJP Athlete",
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
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "DJP Athlete — Elite Sports Performance Coaching",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "DJP Athlete — Elite Sports Performance Coaching",
    description:
      "Elite sports performance coaching by Darren J Paul, PhD. Assessment-led, individualized programming for serious athletes.",
    images: ["/og-image.png"],
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-icon.png",
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
        <noscript>
          <style>{`[style*="opacity: 0"] { opacity: 1 !important; transform: none !important; }`}</style>
        </noscript>
        <SessionProvider>
          {children}
          <Toaster />
        </SessionProvider>
        <GoogleAnalytics />
      </body>
    </html>
  )
}
