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
}

function formatPrice(cents: number) {
  const dollars = cents / 100
  return dollars % 1 === 0 ? `$${dollars}` : `$${dollars.toFixed(2)}`
}

export function EventCardCta({ event }: EventCardCtaProps) {
  const [open, setOpen] = useState(false)
  const isFull = event.signup_count >= event.capacity
  const isCamp = event.type === "camp"

  if (isCamp && !isFull) {
    if (!event.stripe_price_id) {
      return (
        <Button disabled title="Pricing not yet configured" className="w-full">
          Book — coming soon
        </Button>
      )
    }
    const priceLabel = event.price_cents != null ? formatPrice(event.price_cents) : null
    return (
      <>
        <Button className="w-full" onClick={() => setOpen(true)}>
          {priceLabel ? `Book camp — ${priceLabel}` : "Book camp"}
        </Button>
        <EventSignupModal event={event} open={open} onOpenChange={setOpen} isWaitlist={false} />
      </>
    )
  }

  return (
    <>
      <Button className="w-full" onClick={() => setOpen(true)}>
        {isFull ? "Full — join waitlist" : "Register your interest"}
      </Button>
      <EventSignupModal event={event} open={open} onOpenChange={setOpen} isWaitlist={isFull} />
    </>
  )
}
