"use client"

import { useState, useEffect, useCallback } from "react"
import { Star, Quote } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

type Review = {
  id: string
  quote: string
  name: string
  role: string
  sport: string
}

const reviews: Review[] = [
  {
    id: "marcus",
    quote:
      "DJP Athlete completely transformed my training. The personalized plans and performance tracking helped me shave 3 seconds off my 40-yard dash in just two months.",
    name: "Marcus T.",
    role: "College Football",
    sport: "Speed & Agility",
  },
  {
    id: "sarah",
    quote:
      "The video analysis alone is worth it. My coach breaks down every rep and gives feedback I can actually apply in my next session. I have never felt more prepared for competition.",
    name: "Sarah K.",
    role: "Competitive CrossFit",
    sport: "Strength & Conditioning",
  },
  {
    id: "james",
    quote:
      "As a weekend runner, I was not sure if elite coaching was for me. But DJP Athlete met me where I was and helped me finish my first marathon injury-free. Could not recommend it more.",
    name: "James R.",
    role: "Recreational Runner",
    sport: "Endurance",
  },
]

const AUTOPLAY_INTERVAL = 6000

function StarRating() {
  return (
    <div className="flex gap-1" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className="size-5 fill-accent text-accent" />
      ))}
    </div>
  )
}

export function CustomerReviews() {
  const [activeIndex, setActiveIndex] = useState(0)
  const [isPaused, setIsPaused] = useState(false)

  const goToNext = useCallback(() => {
    setActiveIndex((prev) => (prev + 1) % reviews.length)
  }, [])

  useEffect(() => {
    if (isPaused) return
    const timer = setInterval(goToNext, AUTOPLAY_INTERVAL)
    return () => clearInterval(timer)
  }, [isPaused, goToNext])

  const active = reviews[activeIndex]

  return (
    <section
      id="testimonials"
      className="w-full py-16 lg:py-24 px-4 sm:px-8 bg-surface"
    >
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="text-2xl sm:text-3xl lg:text-[40px] leading-tight font-semibold tracking-tight mb-6 text-primary">
            Trusted by athletes at every level.
          </h2>
          <p className="text-lg leading-7 text-muted-foreground max-w-2xl mx-auto">
            From youth sports to professional competition, athletes use DJP Athlete to train smarter, recover faster, and perform better — here is what they have to say.
          </p>
        </motion.div>

        {/* Spotlight Card */}
        <motion.div
          className="relative"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.6, delay: 0.2 }}
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
        >
          <div className="relative bg-white rounded-2xl shadow-lg border border-border/40 overflow-hidden">
            {/* Decorative quote icon */}
            <div className="absolute top-6 right-8 opacity-[0.06]">
              <Quote className="size-32 text-primary" strokeWidth={1} />
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={active.id}
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -40 }}
                transition={{ duration: 0.4, ease: "easeInOut" }}
                className="relative z-10 flex flex-col md:flex-row items-center gap-8 p-8 md:p-12"
              >
                {/* Avatar placeholder */}
                <div className="shrink-0">
                  <div className="relative size-28 md:size-36 rounded-2xl overflow-hidden ring-4 ring-primary/10 shadow-md bg-surface flex items-center justify-center">
                    <span className="text-4xl font-semibold text-primary/60 font-heading">
                      {active.name.charAt(0)}
                    </span>
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 text-center md:text-left">
                  <StarRating />
                  <blockquote className="mt-4">
                    <p className="text-lg md:text-xl text-foreground leading-relaxed">
                      &ldquo;{active.quote}&rdquo;
                    </p>
                  </blockquote>
                  <div className="mt-6 flex items-center gap-3 justify-center md:justify-start">
                    <div className="h-px w-8 bg-primary/50" aria-hidden />
                    <div>
                      <p className="font-semibold text-primary">
                        {active.name}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {active.role} &middot; {active.sport}
                      </p>
                    </div>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Progress bar */}
            <div className="h-1 bg-muted/30">
              <motion.div
                className="h-full bg-gradient-to-r from-primary via-primary/70 to-accent"
                key={`progress-${activeIndex}-${isPaused}`}
                initial={{ width: "0%" }}
                animate={{ width: isPaused ? undefined : "100%" }}
                transition={{
                  duration: AUTOPLAY_INTERVAL / 1000,
                  ease: "linear",
                }}
              />
            </div>
          </div>
        </motion.div>

        {/* Thumbnail Navigation */}
        <motion.div
          className="mt-8 flex justify-center gap-4 md:gap-6"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          {reviews.map((review, index) => {
            const isActive = index === activeIndex
            return (
              <motion.button
                key={review.id}
                onClick={() => setActiveIndex(index)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.97 }}
                className={`
                  relative flex items-center gap-3 rounded-xl px-4 py-3
                  border-2 transition-colors duration-300 cursor-pointer
                  ${
                    isActive
                      ? "border-primary bg-white shadow-md"
                      : "border-transparent bg-white/60 hover:bg-white hover:shadow-sm"
                  }
                `}
              >
                <div
                  className={`
                    relative size-10 md:size-12 rounded-lg overflow-hidden shrink-0
                    transition-all duration-300 bg-surface flex items-center justify-center
                    ${isActive ? "ring-2 ring-primary/30" : "grayscale opacity-60"}
                  `}
                >
                  <span className="text-sm font-semibold text-primary/60">
                    {review.name.charAt(0)}
                  </span>
                </div>
                <span
                  className={`
                    hidden md:block text-sm font-medium transition-colors duration-300
                    ${isActive ? "text-primary" : "text-muted-foreground"}
                  `}
                >
                  {review.name}
                </span>
              </motion.button>
            )
          })}
        </motion.div>
      </div>
    </section>
  )
}
