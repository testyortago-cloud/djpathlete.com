export type NavLink = {
  label: string
  href: string
  description?: string
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
  { label: "Resources", href: "/resources" },
  { label: "Education", href: "/education" },
  { label: "Blog", href: "/blog" },
  { label: "Coming Soon", href: "/coming-soon" },
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
      { label: "Coming Soon", href: "/coming-soon" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Blog", href: "/blog" },
      { label: "Workshop Clinic", href: "/resources" },
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
