// Buy CTA.
//
// Deliberately a routed link, not an anonymous Stripe session. /api/stripe/checkout
// requires a signed-in user, and building a logged-out purchase path would mean
// changing Stripe webhook handling for orders with no owning user — a money-path
// change that needs its own design. This sends the visitor into the existing,
// tested purchase flow instead.

import Link from "next/link"
import { ctaClassFor } from "@/lib/funnels/cta-class"

interface CheckoutIslandProps {
  props: Record<string, unknown>
}

export function CheckoutIsland({ props }: CheckoutIslandProps) {
  const productId = typeof props.productId === "string" ? props.productId : ""
  const label = typeof props.label === "string" ? props.label : "Buy now"
  const kind = props.productKind === "session_pack" ? "session_pack" : "program"

  const destination =
    kind === "session_pack" ? "/client/sessions" : `/client/programs/${productId}`
  const href = `/login?callbackUrl=${encodeURIComponent(destination)}`

  // `ctaClassFor` — NOT a hard-coded "djp-btn djp-btn-primary". Where this
  // button sits decides how it looks (a hero's primary, a footer's link row),
  // and only `render.ts` knows that; an island that picked for itself would
  // turn a footer link row into a wall of buttons. Empty string on a page
  // published before `variant` existed, which is exactly today's appearance.
  const className = ctaClassFor(props.variant)

  return (
    <Link href={href} className={className || undefined} data-djp-island="checkout" data-djp-kind={kind}>
      {label}
    </Link>
  )
}
