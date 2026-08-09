// Routed call-to-action for application funnels.
//
// There is no public booking widget in this app to embed — enquiries run
// through /contact, which already creates a lead and notifies the coach — so
// this island routes rather than pretending to be a calendar.

import Link from "next/link"

interface BookingIslandProps {
  props: Record<string, unknown>
}

export function BookingIsland({ props }: BookingIslandProps) {
  const label = typeof props.label === "string" ? props.label : "Book a call"
  const href = typeof props.href === "string" && props.href.length > 0 ? props.href : "/contact"

  return (
    <Link href={href} data-djp-island="booking">
      {label}
    </Link>
  )
}
