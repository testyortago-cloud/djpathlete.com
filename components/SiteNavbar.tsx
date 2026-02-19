"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { motion } from "framer-motion"
import { Menu } from "lucide-react"
import { NAV_ITEMS } from "@/lib/constants"
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"

export function SiteNavbar() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const pathname = usePathname()

  // Pages with dark hero backgrounds where nav text should be white
  const isDarkHero = pathname === "/"

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20)
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  // When scrolled, always use dark text (white bg). When not scrolled on dark hero, use white text.
  const useLight = isDarkHero && !isScrolled

  return (
    <motion.nav
      className="fixed top-0 left-0 right-0 z-50 flex justify-center overflow-visible"
      animate={{
        paddingTop: isScrolled ? 12 : 0,
        paddingLeft: isScrolled ? 16 : 0,
        paddingRight: isScrolled ? 16 : 0,
      }}
      transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
    >
      <motion.div
        className="w-full"
        animate={{
          maxWidth: isScrolled ? 1000 : 10000,
          borderRadius: isScrolled ? 100 : 0,
          backgroundColor: isScrolled ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0)",
          boxShadow: isScrolled
            ? "0 4px 24px -4px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04)"
            : "0 0 0 0 rgba(0,0,0,0)",
        }}
        transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
        style={{
          backdropFilter: isScrolled ? "blur(16px)" : "none",
          WebkitBackdropFilter: isScrolled ? "blur(16px)" : "none",
        }}
      >
        <div className="px-6 lg:px-8">
          <div
            className="flex items-center justify-between transition-all duration-300"
            style={{ height: isScrolled ? 56 : 80 }}
          >
            {/* Logo */}
            <Link href="/" className="flex-shrink-0 flex items-center">
              <span
                className={`font-heading font-semibold tracking-tight transition-all duration-300 ${
                  useLight ? "text-white" : "text-primary"
                }`}
                style={{ fontSize: isScrolled ? 18 : 22 }}
              >
                DJP Athlete
              </span>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden lg:flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
                return (
                  <Link
                    key={item.label}
                    href={item.href!}
                    className={`px-3 py-2 rounded-md text-sm transition-colors ${
                      isActive
                        ? useLight
                          ? "text-white font-medium"
                          : "text-primary font-medium"
                        : useLight
                          ? "text-white/70 hover:text-white font-normal"
                          : "text-foreground/70 hover:text-primary font-normal"
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>

            {/* Desktop CTA */}
            <div className="hidden lg:flex items-center gap-3">
              <Link
                href="/login"
                className={`text-sm font-medium transition-colors whitespace-nowrap ${
                  useLight
                    ? "text-white/80 hover:text-white"
                    : "text-primary hover:text-foreground/80"
                }`}
              >
                Log in
              </Link>
              <Link
                href="/contact"
                className={`px-4 py-2.5 rounded-full text-sm font-medium transition-all duration-200 hover:shadow-md whitespace-nowrap leading-4 ${
                  useLight
                    ? "bg-accent text-primary hover:bg-accent/90"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                }`}
              >
                Get Started
              </Link>
            </div>

            {/* Mobile Menu */}
            <div className="lg:hidden">
              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild>
                  <button
                    className={`p-2 ${useLight ? "text-white" : "text-foreground"}`}
                    aria-label="Open menu"
                  >
                    <Menu className="w-6 h-6" />
                  </button>
                </SheetTrigger>
                <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
                  <SheetHeader>
                    <SheetTitle>
                      <span className="font-heading text-xl font-semibold text-primary">
                        DJP Athlete
                      </span>
                    </SheetTitle>
                  </SheetHeader>
                  <div className="mt-6 px-2 space-y-1">
                    {NAV_ITEMS.map((item) => (
                      <Link
                        key={item.label}
                        href={item.href!}
                        onClick={() => setMobileMenuOpen(false)}
                        className={`block py-3 px-3 rounded-lg text-base transition-colors ${
                          pathname === item.href
                            ? "text-primary font-medium bg-surface"
                            : "text-foreground hover:text-primary hover:bg-surface"
                        }`}
                      >
                        {item.label}
                      </Link>
                    ))}
                    <div className="mt-8 space-y-3 pt-4 border-t border-border">
                      <Link
                        href="/login"
                        onClick={() => setMobileMenuOpen(false)}
                        className="block w-full text-center border border-primary text-primary px-6 py-4 rounded-full text-base font-medium hover:bg-surface transition-colors"
                      >
                        Log in
                      </Link>
                      <Link
                        href="/contact"
                        onClick={() => setMobileMenuOpen(false)}
                        className="block w-full text-center bg-primary text-primary-foreground px-6 py-4 rounded-full text-base font-medium"
                      >
                        Get Started
                      </Link>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.nav>
  )
}
