import { SiteNavbar } from "@/components/SiteNavbar"
import { Footer } from "@/components/Footer"
import { StickyApplyCTA } from "@/components/public/StickyApplyCTA"

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteNavbar />
      <main className="min-h-screen">{children}</main>
      <Footer />
      <StickyApplyCTA />
    </>
  )
}
