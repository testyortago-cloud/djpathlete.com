import type { Metadata } from "next"
import { ExternalLink } from "lucide-react"
import Link from "next/link"
import { JsonLd } from "@/components/shared/JsonLd"
import { ShopEmbed } from "./ShopEmbed"

export const metadata: Metadata = {
  title: "Shop",
  description:
    "Shop DJP Athlete performance apparel and training gear. Compression wear, training tops, and branded athletic clothing.",
  openGraph: {
    title: "Shop | DJP Athlete",
    description: "Shop DJP Athlete performance apparel and training gear.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Shop | DJP Athlete",
    description: "Shop DJP Athlete performance apparel and training gear.",
  },
}

const shopSchema = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "Shop — DJP Athlete",
  description: "Shop DJP Athlete performance apparel and training gear.",
  url: "https://djpathlete.com/shop",
  publisher: {
    "@type": "Organization",
    name: "DJP Athlete",
    url: "https://djpathlete.com",
  },
}

export default function ShopPage() {
  return (
    <>
      <JsonLd data={shopSchema} />

      {/* Header */}
      <section className="pt-32 pb-8 lg:pt-40 lg:pb-10 px-4 sm:px-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px w-12 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">Shop</p>
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-semibold text-primary tracking-tight">
              Performance Gear
            </h1>
          </div>
          <Link
            href="https://shop.yortago.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-accent transition-colors group"
          >
            Open full store
            <ExternalLink className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </section>

      {/* Embedded Shop */}
      <section className="pb-16 lg:pb-24 px-4 sm:px-8">
        <div className="max-w-6xl mx-auto">
          <ShopEmbed />
        </div>
      </section>
    </>
  )
}
