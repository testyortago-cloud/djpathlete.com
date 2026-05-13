/**
 * Canonical production origin. Used for sitemap, robots, metadataBase,
 * JSON-LD `url` fields, OG/Twitter URLs, email links, and bot User-Agents.
 * Always include the protocol and `www` so all signals are consistent.
 */
export const SITE_URL = "https://www.darrenjpaul.com"

import type { ComponentType, SVGProps } from "react"
import {
  TennisIcon,
  GolfIcon,
  BaseballIcon,
  SoccerIcon,
  LacrosseIcon,
  PickleballIcon,
} from "@/lib/icons/sports"

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
  {
    label: "Sports",
    href: "/sports",
    children: [
      { label: "Tennis", href: "/sports/tennis-performance-training", description: "Acceleration, deceleration, rotational power", icon: TennisIcon },
      { label: "Golf", href: "/sports/golf-performance-training", description: "Clubhead speed and rotational power", icon: GolfIcon },
      { label: "Baseball", href: "/sports/baseball-performance-training", description: "Exit velocity, throwing velocity, durability", icon: BaseballIcon },
      { label: "Soccer", href: "/sports/soccer-performance-training", description: "Acceleration, deceleration, decisions", icon: SoccerIcon },
      { label: "Lacrosse", href: "/sports/lacrosse-performance-training", description: "Stick speed, dodge agility, capacity", icon: LacrosseIcon },
      { label: "Pickleball", href: "/sports/pickleball-performance-training", description: "Lateral speed, durability, longevity", icon: PickleballIcon },
      { label: "All sports →", href: "/sports", description: "See every sport-specific program" },
    ],
  },
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
    title: "Sports",
    links: [
      { label: "Tennis", href: "/sports/tennis-performance-training" },
      { label: "Golf", href: "/sports/golf-performance-training" },
      { label: "Baseball", href: "/sports/baseball-performance-training" },
      { label: "Soccer", href: "/sports/soccer-performance-training" },
      { label: "Lacrosse", href: "/sports/lacrosse-performance-training" },
      { label: "Pickleball", href: "/sports/pickleball-performance-training" },
      { label: "All sports", href: "/sports" },
    ],
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
