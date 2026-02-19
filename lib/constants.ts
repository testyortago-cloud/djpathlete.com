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
    label: "Programs",
    children: [
      { label: "Training Plans", href: "/programs/training-plans", description: "Customized programs for your goals" },
      { label: "Performance Tracking", href: "/programs/performance-tracking", description: "Monitor progress and metrics" },
      { label: "Video Analysis", href: "/programs/video-analysis", description: "Technique review and feedback" },
      { label: "Nutrition Coaching", href: "/programs/nutrition", description: "Fuel your performance" },
      { label: "Strength & Conditioning", href: "/programs/strength-conditioning", description: "Build power and endurance" },
      { label: "Recovery & Mobility", href: "/programs/recovery", description: "Optimize rest and flexibility" },
    ],
  },
  { label: "Services", href: "/services" },
  { label: "About", href: "/about" },
  { label: "Testimonials", href: "/testimonials" },
  { label: "Contact", href: "/contact" },
]

export const FOOTER_SECTIONS = [
  {
    title: "Programs",
    links: [
      { label: "Training Plans", href: "/programs/training-plans" },
      { label: "Performance Tracking", href: "/programs/performance-tracking" },
      { label: "Video Analysis", href: "/programs/video-analysis" },
      { label: "Nutrition Coaching", href: "/programs/nutrition" },
      { label: "Strength & Conditioning", href: "/programs/strength-conditioning" },
    ],
  },
  {
    title: "Athletes",
    links: [
      { label: "Youth Athletes", href: "/athletes/youth" },
      { label: "College Athletes", href: "/athletes/college" },
      { label: "Professional Athletes", href: "/athletes/professional" },
      { label: "Weekend Warriors", href: "/athletes/recreational" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "About", href: "/about" },
      { label: "Services", href: "/services" },
      { label: "Testimonials", href: "/testimonials" },
      { label: "Contact", href: "/contact" },
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
