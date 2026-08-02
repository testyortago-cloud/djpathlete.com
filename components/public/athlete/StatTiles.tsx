"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { useInView } from "framer-motion"
import { Dumbbell, Flame, Trophy, Weight } from "lucide-react"
import type { AthleteProfileData } from "@/lib/profile-share/data"

/** 412300 → "412K", 1500000 → "1.5M", 840 → "840". */
export function formatCompact(n: number): string {
  if (n >= 999_500) return `${parseFloat((n / 1_000_000).toFixed(1))}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(Math.round(n))
}

function Counter({ target, format }: { target: number; format: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const isInView = useInView(ref, { once: true, margin: "-40px" })
  const [count, setCount] = useState(0)
  const [printing, setPrinting] = useState(false)

  // Printing must always capture final values, not a mid-animation frame.
  // flushSync: window.print() fires beforeprint synchronously, so the DOM
  // update must land before the print snapshot is taken.
  useEffect(() => {
    const snap = () => {
      flushSync(() => {
        setPrinting(true)
        setCount(target)
      })
    }
    window.addEventListener("beforeprint", snap)
    return () => window.removeEventListener("beforeprint", snap)
  }, [target])

  const animate = useCallback(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setCount(target)
      return () => {}
    }
    const duration = 1600
    const steps = 50
    let step = 0
    const timer = setInterval(() => {
      step++
      const eased = 1 - Math.pow(1 - step / steps, 3)
      setCount(Math.round(eased * target))
      if (step >= steps) {
        setCount(target)
        clearInterval(timer)
      }
    }, duration / steps)
    return () => clearInterval(timer)
  }, [target])

  useEffect(() => {
    if (isInView) return animate()
  }, [isInView, animate])

  return <span ref={ref}>{format(printing || isInView ? count : 0)}</span>
}

const TILES = [
  { key: "workouts", label: "Workouts", icon: Dumbbell, format: formatCompact },
  { key: "streakDays", label: "Day Streak", icon: Flame, format: formatCompact },
  { key: "prCount", label: "PRs Set", icon: Trophy, format: formatCompact },
  { key: "totalVolumeKg", label: "KG Lifted", icon: Weight, format: formatCompact },
] as const

// Internal hairlines for the 2×2 (mobile) → 1×4 (md) scoreboard grid.
const CELL_DIVIDERS = [
  "",
  "border-l border-border",
  "border-t border-border md:border-t-0 md:border-l",
  "border-l border-t border-border md:border-t-0",
] as const

/** Scoreboard strip — one glassy panel with internal dividers, overlapping the hero cut line. */
export function StatTiles({ stats }: { stats: AthleteProfileData["stats"] }) {
  return (
    <section
      aria-label="Key stats"
      className="relative -mt-10 grid grid-cols-2 overflow-hidden rounded-2xl border border-border bg-card/85 shadow-[0_24px_64px_-24px_oklch(0_0_0/0.6)] backdrop-blur-sm md:-mt-12 md:grid-cols-4"
    >
      {/* Accent hairline along the panel's top edge. */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent" />
      {TILES.map(({ key, label, icon: Icon, format }, i) => (
        <div key={key} className={`p-5 text-center md:p-6 ${CELL_DIVIDERS[i]}`}>
          <div className="mx-auto mb-2.5 flex size-8 items-center justify-center rounded-lg bg-accent/10">
            <Icon className="size-4 text-accent" strokeWidth={1.5} />
          </div>
          <div className="font-heading text-3xl font-bold tabular-nums text-primary md:text-4xl">
            <Counter target={stats[key]} format={format} />
          </div>
          <div className="mt-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
        </div>
      ))}
    </section>
  )
}
