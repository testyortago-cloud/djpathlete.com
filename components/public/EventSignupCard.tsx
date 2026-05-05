"use client"

import { useState } from "react"
import Image from "next/image"
import { CalendarDays, MapPin } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { EventSignupModal } from "@/components/public/EventSignupModal"
import type { Event } from "@/types/database"

interface EventSignupCardProps {
  event: Event
  /** Pre-rendered HTML for the active liability waiver, or null if no document
   *  is configured. Shown inside the signup modal — parents must accept before
   *  submitting either an interest, paid, or waitlist signup. */
  waiverContent: string | null
}

function formatPrice(cents: number | null) {
  if (cents == null) return null
  const dollars = cents / 100
  return dollars % 1 === 0 ? `$${dollars}` : `$${dollars.toFixed(2)}`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  })
}

function formatEventWhen(event: Event) {
  if (event.type === "clinic") {
    const datePart = formatDate(event.start_date)
    const startTime = formatTime(event.start_date)
    if (event.end_date) {
      return `${datePart} · ${startTime} – ${formatTime(event.end_date)}`
    }
    return `${datePart} · ${startTime}`
  }
  if (event.end_date) {
    const start = new Date(event.start_date)
    const end = new Date(event.end_date)
    const sameYear = start.getUTCFullYear() === end.getUTCFullYear()
    const startLabel = start.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
      ...(sameYear ? {} : { year: "numeric" }),
    })
    const endLabel = end.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    })
    return `${startLabel} – ${endLabel}`
  }
  return formatDate(event.start_date)
}

export function EventSignupCard({ event, waiverContent }: EventSignupCardProps) {
  const [open, setOpen] = useState(false)
  const [intent, setIntent] = useState<"paid" | "interest">("paid")
  const isFull = event.signup_count >= event.capacity
  const price = formatPrice(event.price_cents)
  const spotsLeft = Math.max(0, event.capacity - event.signup_count)
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
            Or express interest only — Darren will follow up
          </button>
        </div>
      )
    }
    if (event.price_cents != null) {
      // Priced but Stripe not yet configured — gate booking, allow interest fallback.
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
    // Free event — interest only
    return (
      <Button className="w-full" onClick={() => openWith("interest")}>
        Register your interest
      </Button>
    )
  }

  return (
    <>
      {/* Desktop / large-screen sticky card */}
      <Card className="hidden lg:block lg:sticky lg:top-24 rounded-2xl border-border">
        <CardContent className="p-6">
          {event.hero_image_url && (
            <div className="relative mb-4 aspect-[16/9] overflow-hidden rounded-lg">
              <Image
                src={event.hero_image_url}
                alt={event.title}
                fill
                sizes="(min-width: 1024px) 33vw, 100vw"
                className="object-cover"
              />
            </div>
          )}

          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <CalendarDays className="h-4 w-4" />
              <span>{formatEventWhen(event)}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="h-4 w-4" />
              <span>{event.location_name}</span>
            </div>
          </div>

          <div className="mt-4">
            {isFull ? (
              <p className="text-sm font-semibold text-accent">Full — join waitlist</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {spotsLeft} {spotsLeft === 1 ? "spot" : "spots"} left
              </p>
            )}
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div
                className={`h-full ${isFull ? "bg-accent" : "bg-primary"}`}
                style={{ width: `${Math.min(100, (event.signup_count / event.capacity) * 100)}%` }}
              />
            </div>
          </div>

          {price && <p className="mt-4 text-xl font-semibold">{price}</p>}

          <div className="mt-6">{cta()}</div>
        </CardContent>
      </Card>

      {/* Mobile sticky bottom bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-4 shadow-lg backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="flex-1 text-sm">
            {price && <div className="font-semibold">{price}</div>}
            {isFull ? (
              <div className="text-accent">Waitlist only</div>
            ) : (
              <div className="text-muted-foreground">{spotsLeft} spots left</div>
            )}
          </div>
          <div className="w-40">{cta()}</div>
        </div>
      </div>

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
