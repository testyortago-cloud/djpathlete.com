"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { EventSignupModal, type EventSignupModalEvent } from "@/components/public/EventSignupModal"

interface EventCardCtaProps {
  event: EventSignupModalEvent & { type: "clinic" | "camp" }
}

export function EventCardCta({ event }: EventCardCtaProps) {
  const [open, setOpen] = useState(false)
  const isFull = event.signup_count >= event.capacity
  const isCamp = event.type === "camp"

  if (isCamp && !isFull) {
    return (
      <Button disabled title="Paid camp booking opens in Phase 3" className="w-full">
        Book — coming soon
      </Button>
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
