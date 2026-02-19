import { SiteNavbar } from "@/components/SiteNavbar"
import { Footer } from "@/components/Footer"

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <SiteNavbar />
      <main className="min-h-screen">{children}</main>
      <Footer />
    </>
  )
}
