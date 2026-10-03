"use client"

import { useState, useEffect, useCallback } from "react"
import Image from "next/image"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import { Quote, ChevronLeft, ChevronRight, Star, Pause, Play } from "lucide-react"

interface Testimonial {
  name: string
  title: string
  quote: string
  avatarUrl?: string | null
  rating?: number
}

interface TestimonialCarouselProps {
  testimonials: Testimonial[]
  interval?: number
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

function AthletePhoto({ testimonial, thumbnail = false }: { testimonial: Testimonial; thumbnail?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const hasPhoto = testimonial.avatarUrl && testimonial.avatarUrl !== failedUrl

  if (!hasPhoto) {
    return (
      <div
        className={`flex h-full w-full items-center justify-center bg-primary/5 text-primary ${thumbnail ? "text-sm" : "min-h-48 md:min-h-0"}`}
      >
        <span
          aria-hidden="true"
          className={thumbnail ? "font-semibold" : "font-heading text-7xl font-semibold tracking-tight md:text-8xl"}
        >
          {initials(testimonial.name)}
        </span>
      </div>
    )
  }

  return (
    <Image
      src={testimonial.avatarUrl as string}
      alt={thumbnail ? "" : testimonial.name}
      fill
      sizes={thumbnail ? "56px" : "(min-width: 1280px) 460px, (min-width: 768px) 40vw, 100vw"}
      className="object-cover object-top"
      onError={() => setFailedUrl(testimonial.avatarUrl as string)}
    />
  )
}

export function TestimonialCarousel({ testimonials, interval = 8000 }: TestimonialCarouselProps) {
  const [current, setCurrent] = useState(() =>
    Math.max(
      0,
      testimonials.findIndex((athlete) => athlete.avatarUrl),
    ),
  )
  const [paused, setPaused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const motionPreference = useReducedMotion()
  const [reducedMotion, setReducedMotion] = useState(false)
  // Keep the first browser render identical to the server, which cannot read
  // the visitor's motion preference. Apply it once hydration has completed.
  useEffect(() => setReducedMotion(Boolean(motionPreference)), [motionPreference])
  const count = testimonials.length
  const activeIndex = count ? current % count : 0
  const testimonial = testimonials[activeIndex]
  const isPaused = paused || hovered || focused || Boolean(reducedMotion)

  const next = useCallback(() => {
    if (count > 1) setCurrent((index) => (index + 1) % count)
  }, [count])

  useEffect(() => {
    if (isPaused || count < 2 || interval <= 0) return
    const timer = setTimeout(next, interval)
    return () => clearTimeout(timer)
  }, [current, isPaused, count, interval, next])

  if (!testimonial) return null

  const controlClass =
    "flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-card text-primary transition-colors hover:border-primary/40 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label="Athlete testimonials"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
      }}
    >
      <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${activeIndex}-${testimonial.name}`}
            initial={{ opacity: reducedMotion ? 1 : 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: reducedMotion ? 1 : 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.2 }}
            className="grid md:min-h-[440px] md:grid-cols-[2fr_3fr]"
            role="group"
            aria-roledescription="slide"
            aria-label={`${activeIndex + 1} of ${count}`}
          >
            <div
              className={`relative overflow-hidden bg-muted ${testimonial.avatarUrl ? "h-72 sm:h-80 md:h-auto" : "h-48 md:h-auto"}`}
            >
              <AthletePhoto testimonial={testimonial} />
            </div>
            <div className="flex flex-col items-start justify-center px-6 py-8 sm:px-10 sm:py-10 lg:px-14 lg:py-12">
              <div className="mb-6 flex w-full items-center justify-between gap-4">
                <Quote aria-hidden="true" className="size-9 text-accent" strokeWidth={1.5} />
                {testimonial.rating ? (
                  <div className="flex gap-1" aria-label={`${testimonial.rating} out of 5 stars`}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        aria-hidden="true"
                        className={`size-4 ${i < (testimonial.rating ?? 0) ? "fill-accent text-accent" : "text-border"}`}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
              <blockquote className="mb-8">
                <p className="text-xl font-medium leading-relaxed text-foreground sm:text-2xl lg:text-[1.65rem]">
                  &ldquo;{testimonial.quote}&rdquo;
                </p>
              </blockquote>
              <div className="border-l-2 border-accent pl-4">
                <p className="text-lg font-semibold text-primary">{testimonial.name}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{testimonial.title}</p>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {count > 1 && (
        <div className="mt-6 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 gap-2 overflow-x-auto py-2 px-1" aria-label="Choose an athlete">
            {testimonials.map((athlete, index) => (
              <button
                key={`${athlete.name}-${index}`}
                onClick={() => setCurrent(index)}
                aria-label={`Read ${athlete.name.trim()}'s testimonial`}
                aria-pressed={index === activeIndex}
                title={athlete.name}
                className={`relative size-12 shrink-0 overflow-hidden rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 sm:size-14 ${index === activeIndex ? "ring-2 ring-accent ring-offset-4 ring-offset-background" : "opacity-60 hover:opacity-100"}`}
              >
                <AthletePhoto testimonial={athlete} thumbnail />
              </button>
            ))}
          </div>
          <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
            <p
              className="mr-auto text-sm tabular-nums text-muted-foreground sm:mr-3"
              aria-live={isPaused ? "polite" : "off"}
            >
              {activeIndex + 1} <span className="mx-1 text-border">/</span> {count}
            </p>
            {!reducedMotion && interval > 0 && (
              <button
                onClick={() => setPaused(!paused)}
                aria-label={paused ? "Play testimonials" : "Pause testimonials"}
                className={controlClass}
              >
                {paused ? (
                  <Play aria-hidden="true" className="size-4" />
                ) : (
                  <Pause aria-hidden="true" className="size-4" />
                )}
              </button>
            )}
            <button
              onClick={() => setCurrent((index) => (index - 1 + count) % count)}
              aria-label="Previous testimonial"
              className={controlClass}
            >
              <ChevronLeft aria-hidden="true" className="size-5" />
            </button>
            <button onClick={next} aria-label="Next testimonial" className={controlClass}>
              <ChevronRight aria-hidden="true" className="size-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
