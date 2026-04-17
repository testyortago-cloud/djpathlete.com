"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import {
  Menu,
  ChevronDown,
  Users,
  Globe,
  ClipboardCheck,
  FileText,
  Database,
  Activity,
  Zap,
  Tent,
  type LucideIcon,
} from "lucide-react"
import { NAV_ITEMS, type NavGroup } from "@/lib/constants"
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"

const DROPDOWN_ICONS: Record<string, LucideIcon> = {
  "In-Person Coaching": Users,
  "Online Coaching": Globe,
  Assessment: ClipboardCheck,
  Blog: FileText,
  "Performance Database": Database,
  "Comeback Code": Activity,
  "Agility Clinics": Zap,
  "Performance Camps": Tent,
}

function DesktopDropdown({ item, useLight, pathname }: { item: NavGroup; useLight: boolean; pathname: string }) {
  const [open, setOpen] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isActive = item.children?.some((child) => pathname === child.href || pathname.startsWith(child.href + "/"))

  const handleEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setOpen(true)
  }

  const handleLeave = () => {
    timeoutRef.current = setTimeout(() => setOpen(false), 150)
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  return (
    <div className="relative" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <button
        className={`flex items-center gap-1 px-3 py-2 rounded-md text-sm transition-colors ${
          isActive
            ? useLight
              ? "text-white font-medium"
              : "text-primary font-medium"
            : useLight
              ? "text-white/70 hover:text-white font-normal"
              : "text-foreground/70 hover:text-primary font-normal"
        }`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {item.label}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="absolute top-full left-1/2 -translate-x-1/2 mt-3 w-[320px]"
          >
            {/* Arrow */}
            <div className="flex justify-center -mb-[6px] relative z-10">
              <div className="w-3 h-3 rotate-45 bg-white rounded-sm shadow-[−1px_−1px_2px_rgba(0,0,0,0.04)]" />
            </div>

            <div
              className="relative rounded-2xl overflow-hidden shadow-[0_20px_60px_-15px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.04)]"
              style={{
                background: "rgba(255,255,255,0.95)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
              }}
            >
              {/* Top accent gradient */}
              <div className="h-[2px] bg-gradient-to-r from-primary via-accent to-primary" />

              <div className="p-2">
                {item.children?.map((child, i) => {
                  const Icon = DROPDOWN_ICONS[child.label]
                  const childActive = pathname === child.href || pathname.startsWith(child.href + "/")

                  return (
                    <motion.div
                      key={child.label}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.2, delay: i * 0.05, ease: "easeOut" }}
                    >
                      <Link
                        href={child.href}
                        onClick={() => setOpen(false)}
                        className={`group flex items-start gap-3.5 px-3.5 py-3 rounded-xl transition-all duration-200 ${
                          childActive ? "bg-primary/[0.06]" : "hover:bg-primary/[0.04]"
                        }`}
                      >
                        {/* Icon container */}
                        <div
                          className={`mt-0.5 flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-200 ${
                            childActive
                              ? "bg-primary text-white shadow-sm"
                              : "bg-primary/[0.07] text-primary group-hover:bg-primary group-hover:text-white group-hover:shadow-sm"
                          }`}
                        >
                          {Icon && <Icon className="w-[18px] h-[18px]" strokeWidth={1.8} />}
                        </div>

                        <div className="flex-1 min-w-0">
                          <span
                            className={`block text-[13.5px] leading-tight transition-colors duration-200 ${
                              childActive
                                ? "text-primary font-semibold"
                                : "text-foreground font-medium group-hover:text-primary"
                            }`}
                          >
                            {child.label}
                          </span>
                          {child.description && (
                            <span className="block text-[12px] leading-snug text-muted-foreground/70 mt-0.5">
                              {child.description}
                            </span>
                          )}
                        </div>

                        {/* Active indicator dot */}
                        {childActive && <div className="mt-2.5 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-accent" />}
                      </Link>
                    </motion.div>
                  )
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function MobileDropdown({ item, pathname, onNavigate }: { item: NavGroup; pathname: string; onNavigate: () => void }) {
  const [open, setOpen] = useState(false)

  const isActive = item.children?.some((child) => pathname === child.href || pathname.startsWith(child.href + "/"))

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center justify-between w-full py-3 px-3 rounded-lg text-base transition-colors ${
          isActive ? "text-primary font-medium bg-surface" : "text-foreground hover:text-primary hover:bg-surface"
        }`}
      >
        {item.label}
        <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
            className="overflow-hidden"
          >
            <div className="ml-3 pl-3 py-1 border-l-2 border-primary/10 space-y-0.5">
              {item.children?.map((child, i) => {
                const Icon = DROPDOWN_ICONS[child.label]
                const childActive = pathname === child.href || pathname.startsWith(child.href + "/")
                return (
                  <motion.div
                    key={child.label}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2, delay: i * 0.04 }}
                  >
                    <Link
                      href={child.href}
                      onClick={onNavigate}
                      className={`flex items-center gap-3 py-2.5 px-3 rounded-lg text-sm transition-colors ${
                        childActive
                          ? "text-primary font-medium bg-primary/[0.06]"
                          : "text-foreground/80 hover:text-primary hover:bg-surface"
                      }`}
                    >
                      {Icon && (
                        <Icon
                          className={`w-4 h-4 flex-shrink-0 ${childActive ? "text-primary" : "text-muted-foreground"}`}
                          strokeWidth={1.8}
                        />
                      )}
                      <div>
                        {child.label}
                        {child.description && (
                          <span className="block text-xs text-muted-foreground mt-0.5">{child.description}</span>
                        )}
                      </div>
                    </Link>
                  </motion.div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function SiteNavbar() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const pathname = usePathname()

  // Pages with dark hero backgrounds where nav text should be white.
  // Exact matches first, then prefix matches for routes with sub-pages (e.g. /clinics/[slug]).
  const darkHeroExact = ["/", "/in-person", "/education", "/shop"]
  const darkHeroPrefixes = ["/clinics", "/online"]
  const isDarkHero =
    darkHeroExact.includes(pathname) ||
    darkHeroPrefixes.some((p) => pathname === p || pathname.startsWith(p + "/"))

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
            <Link href="/" className="flex-shrink-0 flex items-center gap-2.5">
              <Image
                src={useLight ? "/logos/logo-icon-light.png" : "/logos/logo-icon-dark.png"}
                alt="DJP Athlete"
                width={160}
                height={100}
                className="transition-all duration-300 object-contain"
                style={{ height: isScrolled ? 40 : 56, width: "auto" }}
                priority
              />
              <span
                className={`font-heading font-semibold tracking-[0.2em] uppercase transition-all duration-300 ${
                  isScrolled ? "text-sm" : "text-base"
                } ${useLight ? "text-white" : "text-foreground"}`}
              >
                Athlete
              </span>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden xl:flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                if (item.children) {
                  return <DesktopDropdown key={item.label} item={item} useLight={useLight} pathname={pathname} />
                }

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
            <div className="hidden xl:flex items-center gap-3">
              <Link
                href="/login"
                className={`text-sm font-medium transition-colors whitespace-nowrap ${
                  useLight ? "text-white/80 hover:text-white" : "text-primary hover:text-foreground/80"
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
            <div className="xl:hidden">
              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild>
                  <button className={`p-2 ${useLight ? "text-white" : "text-foreground"}`} aria-label="Open menu">
                    <Menu className="w-6 h-6" />
                  </button>
                </SheetTrigger>
                <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
                  <SheetHeader>
                    <SheetTitle className="flex items-center gap-2">
                      <Image
                        src="/logos/logo-icon-dark.png"
                        alt="DJP Athlete"
                        width={140}
                        height={90}
                        className="object-contain"
                        style={{ height: 36, width: "auto" }}
                      />
                      <span className="font-heading font-semibold tracking-[0.2em] text-xs uppercase text-foreground">
                        Athlete
                      </span>
                    </SheetTitle>
                  </SheetHeader>
                  <div className="mt-6 px-2 space-y-1">
                    {NAV_ITEMS.map((item) => {
                      if (item.children) {
                        return (
                          <MobileDropdown
                            key={item.label}
                            item={item}
                            pathname={pathname}
                            onNavigate={() => setMobileMenuOpen(false)}
                          />
                        )
                      }

                      return (
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
                      )
                    })}
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
