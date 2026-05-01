"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { EventSignupModal, type EventSignupModalEvent } from "@/components/public/EventSignupModal"

interface EventCardCtaProps {
  event: EventSignupModalEvent & {
    type: "clinic" | "camp"
    stripe_price_id: string | null
    price_cents: number | null
  }
  waiverContent: string | null
}

function formatPrice(cents: number) {
  const dollars = cents / 100
  return dollars % 1 === 0 ? `$${dollars}` : `$${dollars.toFixed(2)}`
}

export function EventCardCta({ event, waiverContent }: EventCardCtaProps) {
  const [open, setOpen] = useState(false)
  const [intent, setIntent] = useState<"paid" | "interest">("paid")
  const isFull = event.signup_count >= event.capacity
  const isPriced = !!event.stripe_price_id
  const eventLabel = event.type === "clinic" ? "clinic" : "camp"

  function openWith(next: "paid" | "interest") {
    setIntent(next)
    setOpen(true)
  }

  function cta() {
    if (isFull) {
      return (
        <Button className="w-full" onClick={() => openWith("interest")}>
          Full — join waitlist
        </Button>
      )
    }
    if (isPriced) {
      const priceLabel = event.price_cents != null ? formatPrice(event.price_cents) : null
      return (
        <div className="space-y-2">
          <Button className="w-full" onClick={() => openWith("paid")}>
            {priceLabel ? `Reserve & pay — ${priceLabel}` : `Book ${eventLabel}`}
          </Button>
          <button
            type="button"
            onClick={() => openWith("interest")}
            className="block w-full text-center text-xs text-muted-foreground hover:text-primary hover:underline"
          >
            Or express interest only
          </button>
        </div>
      )
    }
    if (event.price_cents != null) {
      return (
        <div className="space-y-2">
          <Button disabled title="Pricing not yet configured" className="w-full">
            Book — coming soon
          </Button>
          <button
            type="button"
            onClick={() => openWith("interest")}
            className="block w-full text-center text-xs text-muted-foreground hover:text-primary hover:underline"
          >
            Express interest meanwhile
          </button>
        </div>
      )
    }
    return (
      <Button className="w-full" onClick={() => openWith("interest")}>
        Register your interest
      </Button>
    )
  }

  return (
    <>
      {cta()}
      <EventSignupModal
        event={event}
        open={open}
        onOpenChange={setOpen}
        isWaitlist={isFull}
        intent={intent}
        waiverContent={waiverContent}
      />
    </>
  )
}
