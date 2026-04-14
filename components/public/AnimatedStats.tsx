"use client"

import { useRef, useEffect, useState, useCallback } from "react"
import { useInView } from "framer-motion"

interface Stat {
  value: string
  label: string
}

function parseValue(value: string): { number: number; suffix: string } {
  const match = value.match(/^(\d+)(.*)$/)
  if (!match) return { number: 0, suffix: value }
  return { number: parseInt(match[1], 10), suffix: match[2] }
}

function Counter({ value, label }: Stat) {
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true, margin: "-80px" })
  const [count, setCount] = useState(0)
  const { number: target, suffix } = parseValue(value)

  const animate = useCallback(() => {
    const duration = 2000
    const steps = 60
    const stepTime = duration / steps
    const increment = target / steps
    let current = 0
    let step = 0

    const timer = setInterval(() => {
      step++
      // Ease-out: fast start, slow end
      const progress = step / steps
      const eased = 1 - Math.pow(1 - progress, 3)
      current = Math.round(eased * target)
      setCount(current)

      if (step >= steps) {
        setCount(target)
        clearInterval(timer)
      }
    }, stepTime)

    return () => clearInterval(timer)
  }, [target])

  useEffect(() => {
    if (isInView) {
      return animate()
    }
  }, [isInView, animate])

  return (
    <div ref={ref} className="text-center">
      <p className="text-3xl lg:text-4xl font-heading font-bold text-primary mb-1">
        {isInView ? `${count}${suffix}` : `0${suffix}`}
      </p>
      <p className="text-sm text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
    </div>
  )
}

interface AnimatedStatsProps {
  stats: Stat[]
}

export function AnimatedStats({ stats }: AnimatedStatsProps) {
  return (
    <section className="py-12 lg:py-16 px-4 sm:px-8 bg-surface border-b border-border">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 lg:gap-12">
          {stats.map((stat) => (
            <Counter key={stat.label} {...stat} />
          ))}
        </div>
      </div>
    </section>
  )
}
