/**
 * Canonical production origin. Used for sitemap, robots, metadataBase,
 * JSON-LD `url` fields, OG/Twitter URLs, email links, and bot User-Agents.
 * Always include the protocol and `www` so all signals are consistent.
 */
export const SITE_URL = "https://www.darrenjpaul.com"

/**
 * Hardcoded coach email — every AI generation notification, weekly digest,
 * and admin alert lands here regardless of which admin clicked the button.
 * Server-side COACH_EMAIL env var should match; this constant is for
 * client-side UI display (toggle labels, dialog hints).
 */
export const COACH_EMAIL = "darren@darrenjpaul.com"

import type { ComponentType, SVGProps } from "react"

/** Lucide-compatible icon component shape — takes className + strokeWidth. */
export type NavIcon = ComponentType<SVGProps<SVGSVGElement> & { strokeWidth?: number | string }>

export type NavLink = {
  label: string
  href: string
  description?: string
  /** Optional icon component rendered in the dropdown slot. */
  icon?: NavIcon
}

export type NavGroup = {
  label: string
  href?: string
  children?: NavLink[]
}

export const NAV_ITEMS: NavGroup[] = [
  { label: "Home", href: "/" },
  {
    label: "Services",
    children: [
      { label: "In-Person Coaching", href: "/in-person", description: "Assessment-led, hands-on training" },
      { label: "Online Coaching", href: "/online", description: "A complete performance system" },
      { label: "Assessment", href: "/assessment", description: "Return-to-performance testing" },
      { label: "Agility Clinics", href: "/clinics", description: "2-hour youth agility workshops" },
      { label: "Performance Camps", href: "/camps", description: "Off-season & pre-season blocks" },
    ],
  },
  { label: "Athletes", href: "/athletes" },
  { label: "About", href: "/about" },
  { label: "Resources", href: "/resources" },
  { label: "Education", href: "/education" },
  { label: "Blog", href: "/blog" },
  { label: "Shop", href: "/shop" },
]

export const SOCIAL_LINKS = {
  linkedin: "https://www.linkedin.com/in/darren-paul-phd-b022a213b",
  instagram: "https://www.instagram.com/darrenjpaul/",
  tiktok: "https://www.tiktok.com/@darrenpaul_coach",
  facebook: "https://www.facebook.com/share/1BwzDFUg66/?mibextid=wwXIfr",
} as const

export const FOOTER_SECTIONS = [
  {
    title: "Services",
    links: [
      { label: "In-Person Coaching", href: "/in-person" },
      { label: "Online Coaching", href: "/online" },
      { label: "Assessment", href: "/assessment" },
      { label: "Agility Clinics", href: "/clinics" },
      { label: "Performance Camps", href: "/camps" },
      { label: "Education", href: "/education" },
      { label: "Shop", href: "/shop" },
    ],
  },
  {
    title: "Athletes",
    links: [{ label: "All athletes", href: "/athletes" }],
  },
  {
    title: "Resources",
    links: [
      { label: "Blog", href: "/blog" },
      { label: "FAQ", href: "/faq" },
      { label: "Glossary", href: "/glossary" },
      { label: "Rotational Reboot", href: "/programs/rotational-reboot" },
      { label: "Resource Library", href: "/resources" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Contact", href: "/contact" },
      { label: "Testimonials", href: "/testimonials" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy Policy", href: "/privacy-policy" },
      { label: "Terms of Service", href: "/terms-of-service" },
    ],
  },
]
