"use client"

import { useEffect, useRef } from "react"
import { motion } from "framer-motion"
import {
  ClipboardCheck,
  Target,
  Dumbbell,
  Timer,
  Heart,
  Video,
  BarChart3,
  Apple,
  Brain,
  Zap,
  TrendingUp,
  Trophy,
  Users,
  Calendar,
  Activity,
  Flame,
  Shield,
  Footprints,
  type LucideIcon,
} from "lucide-react"

type CoachingStage = {
  name: string
  icon: LucideIcon
}

const topRowStages: CoachingStage[] = [
  { name: "Assessment", icon: ClipboardCheck },
  { name: "Goal Setting", icon: Target },
  { name: "Programming", icon: Calendar },
  { name: "Warm-Up", icon: Flame },
  { name: "Strength", icon: Dumbbell },
  { name: "Conditioning", icon: Zap },
  { name: "Speed", icon: Timer },
  { name: "Agility", icon: Footprints },
  { name: "Recovery", icon: Heart },
]

const bottomRowStages: CoachingStage[] = [
  { name: "Video Review", icon: Video },
  { name: "Analytics", icon: BarChart3 },
  { name: "Nutrition", icon: Apple },
  { name: "Mental Game", icon: Brain },
  { name: "Progress", icon: TrendingUp },
  { name: "Competition", icon: Trophy },
  { name: "Team Work", icon: Users },
  { name: "Mobility", icon: Activity },
  { name: "Prevention", icon: Shield },
]

export const IntegrationCarousel = () => {
  const topRowRef = useRef<HTMLDivElement>(null)
  const bottomRowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let topAnimationId: number
    let bottomAnimationId: number
    let topPosition = 0
    let bottomPosition = 0

    const animateTopRow = () => {
      if (topRowRef.current) {
        topPosition -= 0.5
        if (Math.abs(topPosition) >= topRowRef.current.scrollWidth / 2) {
          topPosition = 0
        }
        topRowRef.current.style.transform = `translateX(${topPosition}px)`
      }
      topAnimationId = requestAnimationFrame(animateTopRow)
    }

    const animateBottomRow = () => {
      if (bottomRowRef.current) {
        bottomPosition -= 0.65
        if (Math.abs(bottomPosition) >= bottomRowRef.current.scrollWidth / 2) {
          bottomPosition = 0
        }
        bottomRowRef.current.style.transform = `translateX(${bottomPosition}px)`
      }
      bottomAnimationId = requestAnimationFrame(animateBottomRow)
    }

    topAnimationId = requestAnimationFrame(animateTopRow)
    bottomAnimationId = requestAnimationFrame(animateBottomRow)
    return () => {
      cancelAnimationFrame(topAnimationId)
      cancelAnimationFrame(bottomAnimationId)
    }
  }, [])

  return (
    <div id="process" className="w-full py-16 lg:py-24 bg-white">
      <div className="max-w-[680px] mx-auto px-4 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="flex flex-col items-center mb-20"
        >
          <div className="flex flex-col items-center gap-4">
            <h2 className="text-2xl sm:text-3xl lg:text-[40px] leading-tight font-semibold text-center tracking-tight mb-0 text-primary">
              Every step of your journey, from assessment to competition.
            </h2>
            <p className="text-lg leading-7 text-muted-foreground text-center max-w-[600px] mt-2">
              Plan, track, and optimize every phase of your athletic development
              &mdash; from initial assessment to peak performance and beyond.
            </p>
          </div>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.2, ease: "easeOut" }}
            className="flex gap-3 mt-6"
          >
            <a
              href="#pricing"
              className="inline-block px-5 py-2.5 rounded-full bg-white text-foreground text-[15px] font-medium leading-6 text-center whitespace-nowrap transition-all duration-75 ease-out cursor-pointer hover:shadow-lg border border-border"
            >
              Start Training
            </a>
          </motion.div>
        </motion.div>
      </div>

      <div className="h-[300px] -mt-6 mb-0 pb-0 relative overflow-hidden">
        {/* Top row */}
        <div
          ref={topRowRef}
          className="flex items-start gap-5 absolute top-4 whitespace-nowrap"
          style={{ willChange: "transform" }}
        >
          {[...topRowStages, ...topRowStages].map((stage, index) => {
            const Icon = stage.icon
            return (
              <div
                key={`top-${index}`}
                className="flex flex-col items-center gap-2 w-28 flex-shrink-0"
              >
                <div className="flex items-center justify-center w-24 h-24 rounded-3xl transition-transform duration-300 hover:scale-105 bg-surface shadow-[rgba(0,0,0,0.04)_0px_0px_0px_1px,rgba(0,0,0,0.04)_0px_1px_1px_0px,rgba(0,0,0,0.04)_0px_3px_3px_-1.4px,rgba(0,0,0,0.04)_0px_6px_6px_-3px,rgba(0,0,0,0.04)_0px_12px_12px_-6px]">
                  <Icon className="size-9 text-primary/70" strokeWidth={1.5} />
                </div>
                <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                  {stage.name}
                </span>
              </div>
            )
          })}
        </div>

        {/* Gradient overlays */}
        <div
          className="absolute top-0 right-0 bottom-0 w-60 h-[300px] z-10 pointer-events-none"
          style={{ backgroundImage: "linear-gradient(90deg, rgba(255, 255, 255, 0), rgb(255, 255, 255))" }}
        />
        <div
          className="absolute top-0 left-0 bottom-0 w-60 h-[300px] z-10 pointer-events-none"
          style={{ backgroundImage: "linear-gradient(90deg, rgb(255, 255, 255), rgba(255, 255, 255, 0))" }}
        />

        {/* Bottom row */}
        <div
          ref={bottomRowRef}
          className="flex items-start gap-5 absolute top-[160px] whitespace-nowrap"
          style={{ willChange: "transform" }}
        >
          {[...bottomRowStages, ...bottomRowStages].map((stage, index) => {
            const Icon = stage.icon
            return (
              <div
                key={`bottom-${index}`}
                className="flex flex-col items-center gap-2 w-28 flex-shrink-0"
              >
                <div className="flex items-center justify-center w-24 h-24 rounded-3xl transition-transform duration-300 hover:scale-105 bg-surface shadow-[rgba(0,0,0,0.04)_0px_0px_0px_1px,rgba(0,0,0,0.04)_0px_1px_1px_0px,rgba(0,0,0,0.04)_0px_3px_3px_-1.4px,rgba(0,0,0,0.04)_0px_6px_6px_-3px,rgba(0,0,0,0.04)_0px_12px_12px_-6px]">
                  <Icon className="size-9 text-primary/70" strokeWidth={1.5} />
                </div>
                <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                  {stage.name}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
