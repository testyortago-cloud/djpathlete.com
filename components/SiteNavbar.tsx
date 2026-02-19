"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { motion } from "framer-motion"
import {
  Menu,
  ClipboardList,
  BarChart3,
  Video,
  Apple,
  Dumbbell,
  Heart,
  ArrowRight,
  Sparkles,
} from "lucide-react"
import { NAV_ITEMS } from "@/lib/constants"
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuTrigger,
  NavigationMenuContent,
  NavigationMenuLink,
} from "@/components/ui/navigation-menu"
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion"

const ICON_MAP: Record<string, React.ElementType> = {
  "Training Plans": ClipboardList,
  "Performance Tracking": BarChart3,
  "Video Analysis": Video,
  "Nutrition Coaching": Apple,
  "Strength & Conditioning": Dumbbell,
  "Recovery & Mobility": Heart,
}

export function SiteNavbar() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const pathname = usePathname()

  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), [])

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20)
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

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
          maxWidth: isScrolled ? 900 : 10000,
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
                className="font-heading font-semibold text-primary tracking-tight transition-all duration-300"
                style={{ fontSize: isScrolled ? 18 : 22 }}
              >
                DJP Athlete
              </span>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden lg:flex items-center">
              <NavigationMenu viewport={false}>
                <NavigationMenuList>
                  {NAV_ITEMS.map((group) =>
                    group.children ? (
                      <NavigationMenuItem key={group.label}>
                        <NavigationMenuTrigger className="text-sm font-normal bg-transparent hover:bg-transparent data-[state=open]:bg-transparent">
                          {group.label}
                        </NavigationMenuTrigger>
                        <NavigationMenuContent>
                          <div className="flex w-[580px] p-2">
                            {/* Featured highlight card */}
                            <div className="w-[200px] flex-shrink-0 rounded-lg p-5 flex flex-col justify-between mr-2 bg-surface">
                              <div>
                                <div className="flex items-center gap-1.5 mb-3">
                                  <Sparkles className="w-4 h-4 text-foreground/80" />
                                  <span className="text-xs font-medium text-foreground/80 uppercase tracking-wide">
                                    New
                                  </span>
                                </div>
                                <p className="text-sm font-medium text-primary leading-snug mb-2">
                                  Video analysis for technique review
                                </p>
                                <p className="text-xs text-muted-foreground leading-relaxed">
                                  Upload footage and get frame-by-frame coaching feedback.
                                </p>
                              </div>
                              <Link
                                href="/programs/video-analysis"
                                className="inline-flex items-center gap-1 text-xs font-medium text-primary mt-4 group/link"
                              >
                                Learn more
                                <ArrowRight className="w-3 h-3 transition-transform duration-150 group-hover/link:translate-x-0.5" />
                              </Link>
                            </div>
                            {/* Feature links */}
                            <ul className="flex-1 grid grid-cols-2 gap-0.5">
                              {group.children.map((link) => {
                                const Icon = ICON_MAP[link.label]
                                return (
                                  <li key={link.href}>
                                    <NavigationMenuLink asChild>
                                      <Link
                                        href={link.href}
                                        className="group/item flex items-start gap-3 select-none rounded-lg p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                                      >
                                        {Icon && (
                                          <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-primary/8 text-primary transition-colors group-hover/item:bg-primary/15">
                                            <Icon className="w-4 h-4" />
                                          </div>
                                        )}
                                        <div>
                                          <div className="text-sm font-medium leading-none mb-1">
                                            {link.label}
                                          </div>
                                          {link.description && (
                                            <p className="text-xs leading-snug text-muted-foreground">
                                              {link.description}
                                            </p>
                                          )}
                                        </div>
                                      </Link>
                                    </NavigationMenuLink>
                                  </li>
                                )
                              })}
                            </ul>
                          </div>
                        </NavigationMenuContent>
                      </NavigationMenuItem>
                    ) : (
                      <NavigationMenuItem key={group.label}>
                        <NavigationMenuLink asChild>
                          <Link
                            href={group.href!}
                            className="group inline-flex h-9 w-max items-center justify-center rounded-md px-4 py-2 text-sm font-normal transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                          >
                            {group.label}
                          </Link>
                        </NavigationMenuLink>
                      </NavigationMenuItem>
                    ),
                  )}
                </NavigationMenuList>
              </NavigationMenu>
            </div>

            {/* Desktop CTA */}
            <div className="hidden lg:flex items-center gap-3">
              <Link
                href="/login"
                className="text-sm font-medium text-primary hover:text-foreground/80 transition-colors whitespace-nowrap"
              >
                Log in
              </Link>
              <Link
                href="#pricing"
                className="bg-primary text-primary-foreground px-4 py-2.5 rounded-full text-sm font-medium hover:bg-primary/90 transition-all duration-200 hover:shadow-md whitespace-nowrap leading-4"
              >
                Get Started
              </Link>
            </div>

            {/* Mobile Menu */}
            <div className="lg:hidden">
              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetTrigger asChild>
                  <button className="p-2 text-foreground" aria-label="Open menu">
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
                  <div className="mt-6 px-2">
                    <Accordion type="single" collapsible className="w-full">
                      {NAV_ITEMS.map((group) =>
                        group.children ? (
                          <AccordionItem key={group.label} value={group.label}>
                            <AccordionTrigger className="text-base font-normal py-3">
                              {group.label}
                            </AccordionTrigger>
                            <AccordionContent>
                              <div className="flex flex-col space-y-1 pl-1">
                                {group.children.map((link) => {
                                  const Icon = ICON_MAP[link.label]
                                  return (
                                    <Link
                                      key={link.href}
                                      href={link.href}
                                      onClick={closeMobileMenu}
                                      className="flex items-center gap-3 py-2.5 px-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                                    >
                                      {Icon && (
                                        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-primary/8 text-primary">
                                          <Icon className="w-3.5 h-3.5" />
                                        </div>
                                      )}
                                      {link.label}
                                    </Link>
                                  )
                                })}
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        ) : (
                          <div key={group.label} className="border-b py-3">
                            <Link
                              href={group.href!}
                              onClick={closeMobileMenu}
                              className="text-base font-normal text-foreground hover:text-primary transition-colors"
                            >
                              {group.label}
                            </Link>
                          </div>
                        ),
                      )}
                    </Accordion>
                    <div className="mt-8 space-y-3">
                      <Link
                        href="/login"
                        onClick={closeMobileMenu}
                        className="block w-full text-center border border-primary text-primary px-6 py-4 rounded-full text-base font-medium hover:bg-surface transition-colors"
                      >
                        Log in
                      </Link>
                      <Link
                        href="#pricing"
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
