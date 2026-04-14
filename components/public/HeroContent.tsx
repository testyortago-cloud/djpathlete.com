"use client"

import { motion } from "framer-motion"
import Link from "next/link"
import { ArrowRight, ChevronDown, ChevronRight } from "lucide-react"

const ease = [0.25, 0.1, 0.25, 1] as const

const item = (delay: number) => ({
  initial: { opacity: 0, y: 20 } as const,
  animate: { opacity: 1, y: 0 } as const,
  transition: { duration: 0.7, delay, ease },
})

export function HeroContent() {
  return (
    <>
      <div className="relative z-10 w-full px-4 sm:px-8 pt-24 pb-28">
        <div className="max-w-6xl mx-auto">
          <div className="lg:ml-auto lg:w-[55%] lg:pl-16">
            {/* Overline */}
            <motion.div {...item(0.2)} className="flex items-center gap-3 mb-8">
              <div className="h-px w-12 bg-accent" />
              <p className="text-sm font-medium text-accent uppercase tracking-widest">DJP Athlete</p>
            </motion.div>

            {/* Headline */}
            <motion.h1
              {...item(0.4)}
              className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-heading font-bold text-primary-foreground tracking-tight leading-[1.08] mb-8"
            >
              Elite Performance
              <br />
              Is Not Trained.
              <br />
              <span className="text-accent">It Is Engineered.</span>
            </motion.h1>

            {/* Sub copy */}
            <motion.p
              {...item(0.6)}
              className="text-lg sm:text-xl text-primary-foreground/70 leading-relaxed max-w-xl mb-12"
            >
              Performance strategist. Coach. Researcher.
              <br className="hidden sm:block" />
              Two decades of elite-level experience.
            </motion.p>

            {/* CTA row */}
            <motion.div {...item(0.8)} className="flex flex-col sm:flex-row items-start gap-4">
              <Link
                href="/in-person"
                className="inline-flex items-center gap-3 bg-accent text-primary px-8 py-4 rounded-full text-sm font-semibold hover:bg-accent/90 transition-all hover:shadow-lg group"
              >
                Explore Services
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                href="/contact"
                className="inline-flex items-center gap-3 border border-white/20 text-primary-foreground px-8 py-4 rounded-full text-sm font-medium hover:bg-white/10 transition-all group"
              >
                Book a Consultation
                <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Scroll Indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4, duration: 0.8 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2"
      >
        <span className="text-xs text-primary-foreground/50 uppercase tracking-widest">Scroll</span>
        <motion.div animate={{ y: [0, 8, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}>
          <ChevronDown className="size-5 text-accent/70" />
        </motion.div>
      </motion.div>
    </>
  )
}
