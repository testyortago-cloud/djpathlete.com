"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import Image from "next/image"
import { motion, AnimatePresence } from "framer-motion"
import { Quote, ChevronLeft, ChevronRight, Star } from "lucide-react"

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

export function TestimonialCarousel({ testimonials, interval = 5000 }: TestimonialCarouselProps) {
  const [current, setCurrent] = useState(0)
  const [direction, setDirection] = useState(1)
  const [isPaused, setIsPaused] = useState(false)
  const [progress, setProgress] = useState(0)
  const progressRef = useRef<number | null>(null)
  const startTimeRef = useRef<number>(0)

  const count = testimonials.length

  const goTo = useCallback(
    (index: number) => {
      setDirection(index > current ? 1 : -1)
      setCurrent(index)
      setProgress(0)
      startTimeRef.current = Date.now()
    },
    [current],
  )

  const next = useCallback(() => {
    setDirection(1)
    setCurrent((prev) => (prev + 1) % count)
    setProgress(0)
    startTimeRef.current = Date.now()
  }, [count])

  const prev = useCallback(() => {
    setDirection(-1)
    setCurrent((prev) => (prev - 1 + count) % count)
    setProgress(0)
    startTimeRef.current = Date.now()
  }, [count])

  // Autoplay + progress bar
  useEffect(() => {
    if (isPaused) {
      if (progressRef.current) cancelAnimationFrame(progressRef.current)
      return
    }

    startTimeRef.current = Date.now() - progress * interval

    const tick = () => {
      const elapsed = Date.now() - startTimeRef.current
      const p = Math.min(elapsed / interval, 1)
      setProgress(p)

      if (p >= 1) {
        next()
      } else {
        progressRef.current = requestAnimationFrame(tick)
      }
    }

    progressRef.current = requestAnimationFrame(tick)
    return () => {
      if (progressRef.current) cancelAnimationFrame(progressRef.current)
    }
  }, [current, isPaused, interval, next, progress])

  const variants = {
    enter: (d: number) => ({ x: d > 0 ? 80 : -80, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (d: number) => ({ x: d > 0 ? -80 : 80, opacity: 0 }),
  }

  if (count === 0) return null

  return (
    <div className="relative" onMouseEnter={() => setIsPaused(true)} onMouseLeave={() => setIsPaused(false)}>
      {/* Carousel viewport */}
      <div className="overflow-hidden">
        <AnimatePresence custom={direction} mode="wait">
          <motion.div
            key={current}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] as const }}
          >
            <div className="relative bg-white rounded-2xl border border-border shadow-sm p-8 sm:p-12 max-w-2xl mx-auto flex flex-col items-center text-center">
              <Quote className="size-12 text-accent/25 mb-6" />
              {testimonials[current].rating ? (
                <div className="mb-5 flex gap-1" aria-label={`${testimonials[current].rating} out of 5 stars`}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`size-5 ${
                        i < (testimonials[current].rating ?? 0) ? "fill-accent text-accent" : "text-border"
                      }`}
                    />
                  ))}
                </div>
              ) : null}
              <blockquote className="mb-8">
                <p className="text-lg sm:text-xl text-foreground/90 leading-relaxed font-medium">
                  &ldquo;{testimonials[current].quote}&rdquo;
                </p>
              </blockquote>
              <div className="flex items-center gap-3">
                {testimonials[current].avatarUrl ? (
                  <Image
                    src={testimonials[current].avatarUrl as string}
                    alt={testimonials[current].name}
                    width={56}
                    height={56}
                    className="size-14 shrink-0 rounded-full object-cover ring-2 ring-accent/20"
                  />
                ) : (
                  <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <span className="text-base font-semibold">{testimonials[current].name.charAt(0)}</span>
                  </div>
                )}
                <div className="text-left">
                  <p className="text-base font-semibold text-foreground">{testimonials[current].name}</p>
                  <p className="text-sm text-muted-foreground">{testimonials[current].title}</p>
                </div>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-center gap-6 mt-8">
        <button
          onClick={prev}
          aria-label="Previous testimonial"
          className="flex size-10 items-center justify-center rounded-full border border-border hover:bg-surface transition-colors"
        >
          <ChevronLeft className="size-4 text-primary" />
        </button>

        {/* Progress dots */}
        <div className="flex items-center gap-3">
          {testimonials.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              aria-label={`Go to testimonial ${i + 1}`}
              className="relative h-2 rounded-full overflow-hidden transition-all duration-300"
              style={{ width: i === current ? 32 : 8 }}
            >
              <div className="absolute inset-0 bg-primary/15 rounded-full" />
              {i === current && (
                <div
                  className="absolute inset-y-0 left-0 bg-accent rounded-full"
                  style={{ width: `${progress * 100}%` }}
                />
              )}
              {i !== current && <div className="absolute inset-0 bg-primary/15 rounded-full" />}
            </button>
          ))}
        </div>

        <button
          onClick={next}
          aria-label="Next testimonial"
          className="flex size-10 items-center justify-center rounded-full border border-border hover:bg-surface transition-colors"
        >
          <ChevronRight className="size-4 text-primary" />
        </button>
      </div>
    </div>
  )
}
