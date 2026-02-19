"use client"

import { motion } from "framer-motion"
import { ArrowRight } from "lucide-react"

export function CTABanner() {
  return (
    <section className="w-full py-16 lg:py-24 px-4 sm:px-8 bg-surface">
      <motion.div
        className="max-w-3xl mx-auto text-center"
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }}
      >
        <h2 className="text-2xl sm:text-3xl lg:text-[40px] leading-tight font-semibold tracking-tight mb-4 text-primary">
          Start training like an elite athlete today
        </h2>
        <p className="text-lg leading-7 text-foreground/70 max-w-xl mx-auto mb-8">
          Join hundreds of athletes using DJP Athlete for personalized coaching, performance tracking, and expert guidance to reach their full potential.
        </p>
        <a
          href="#pricing"
          className="inline-flex items-center gap-2 text-primary-foreground bg-primary rounded-full px-7 py-4 text-base font-medium transition-all duration-200 hover:rounded-2xl hover:shadow-lg hover:bg-primary/90"
        >
          Get Started Free
          <ArrowRight className="w-5 h-5" />
        </a>
      </motion.div>
    </section>
  )
}
