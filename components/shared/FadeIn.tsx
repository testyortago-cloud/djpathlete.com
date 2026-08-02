"use client"

import { motion, useReducedMotion } from "framer-motion"
import type { ReactNode } from "react"

interface FadeInProps {
  children: ReactNode
  delay?: number
  duration?: number
  className?: string
  direction?: "up" | "down" | "left" | "right"
}

const offsets = {
  up: { y: 30 },
  down: { y: -30 },
  left: { x: 30 },
  right: { x: -30 },
}

export function FadeIn({ children, delay = 0, duration = 0.6, className, direction = "up" }: FadeInProps) {
  // Reduced motion keeps the opacity fade but drops the translate — same
  // semantics as framer-motion's MotionConfig reducedMotion="user".
  const reduceMotion = useReducedMotion()
  return (
    <motion.div
      initial={{ opacity: 0, ...(reduceMotion ? {} : offsets[direction]) }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration, delay, ease: [0.25, 0.1, 0.25, 1] as const }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
