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
  })
}

export function EventSignupCard({ event }: EventSignupCardProps) {
  const [open, setOpen] = useState(false)
  const isFull = event.signup_count >= event.capacity
  const isCamp = event.type === "camp"
  const price = formatPrice(event.price_cents)
  const spotsLeft = Math.max(0, event.capacity - event.signup_count)

  function cta() {
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
        <Button className="w-full" onClick={() => setOpen(true)}>
          {priceLabel ? `Book camp — ${priceLabel}` : "Book camp"}
        </Button>
      )
    }
    return (
      <Button className="w-full" onClick={() => setOpen(true)}>
        {isFull ? "Full — join waitlist" : "Register your interest"}
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
              <span>{formatDate(event.start_date)}</span>
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

      <EventSignupModal event={event} open={open} onOpenChange={setOpen} isWaitlist={isFull} />
    </>
  )
}
