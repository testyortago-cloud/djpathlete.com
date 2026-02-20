"use client"

import { useEffect, useState, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Trophy, Flame, Star, CheckCircle2 } from "lucide-react"

interface CelebrationAchievement {
  achievement_type: string
  title: string
  description: string | null
  icon: string
}

interface CelebrationOverlayProps {
  achievements: CelebrationAchievement[]
  onComplete: () => void
}

const DISPLAY_DURATION = 3000

function getIconForType(type: string) {
  switch (type) {
    case "pr":
      return Trophy
    case "streak":
      return Flame
    case "milestone":
      return Star
    case "completion":
      return CheckCircle2
    default:
      return Trophy
  }
}

function getHeaderForType(type: string) {
  switch (type) {
    case "pr":
      return "New Personal Record!"
    case "streak":
      return "Streak Achievement!"
    case "milestone":
      return "Milestone Reached!"
    case "completion":
      return "Program Complete!"
    default:
      return "Achievement Unlocked!"
  }
}

function getAccentColorForType(type: string) {
  switch (type) {
    case "pr":
      return "text-amber-500"
    case "streak":
      return "text-orange-500"
    case "milestone":
      return "text-emerald-500"
    case "completion":
      return "text-primary"
    default:
      return "text-accent"
  }
}

function getIconBgForType(type: string) {
  switch (type) {
    case "pr":
      return "bg-amber-500/20"
    case "streak":
      return "bg-orange-500/20"
    case "milestone":
      return "bg-emerald-500/20"
    case "completion":
      return "bg-primary/20"
    default:
      return "bg-accent/20"
  }
}

function fireConfetti(type: string) {
  import("canvas-confetti").then((mod) => {
    const confetti = mod.default

    if (type === "pr") {
      // Gold confetti burst for PRs
      const count = 200
      const defaults = {
        origin: { y: 0.7 },
        colors: ["#C49B7A", "#FFD700", "#FFA500", "#0E3F50"],
      }

      confetti({
        ...defaults,
        particleCount: Math.floor(count * 0.25),
        spread: 26,
        startVelocity: 55,
      })
      confetti({
        ...defaults,
        particleCount: Math.floor(count * 0.2),
        spread: 60,
      })
      confetti({
        ...defaults,
        particleCount: Math.floor(count * 0.35),
        spread: 100,
        decay: 0.91,
        scalar: 0.8,
      })
      confetti({
        ...defaults,
        particleCount: Math.floor(count * 0.1),
        spread: 120,
        startVelocity: 25,
        decay: 0.92,
        scalar: 1.2,
      })
      confetti({
        ...defaults,
        particleCount: Math.floor(count * 0.1),
        spread: 120,
        startVelocity: 45,
      })
    } else if (type === "streak") {
      // Stars for streaks
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ["#FF6B35", "#FFA500", "#FFD700"],
        shapes: ["star"],
        scalar: 1.5,
      })
    } else {
      // Standard confetti for milestones and others
      confetti({
        particleCount: 100,
        spread: 80,
        origin: { y: 0.6 },
        colors: ["#0E3F50", "#C49B7A", "#FFD700", "#22C55E"],
      })
    }
  })
}

export function CelebrationOverlay({
  achievements,
  onComplete,
}: CelebrationOverlayProps) {
  const [currentIndex, setCurrentIndex] = useState(0)

  const advance = useCallback(() => {
    setCurrentIndex((prev) => {
      const next = prev + 1
      if (next >= achievements.length) {
        onComplete()
        return prev
      }
      return next
    })
  }, [achievements.length, onComplete])

  // Fire confetti when showing each achievement
  useEffect(() => {
    if (achievements.length === 0) return

    const current = achievements[currentIndex]
    if (current) {
      fireConfetti(current.achievement_type)
    }
  }, [currentIndex, achievements])

  // Auto-advance timer
  useEffect(() => {
    if (achievements.length === 0) return

    const timer = setTimeout(advance, DISPLAY_DURATION)
    return () => clearTimeout(timer)
  }, [currentIndex, achievements.length, advance])

  if (achievements.length === 0) return null

  const current = achievements[currentIndex]
  if (!current) return null

  const Icon = getIconForType(current.achievement_type)
  const header = getHeaderForType(current.achievement_type)
  const iconColor = getAccentColorForType(current.achievement_type)
  const iconBg = getIconBgForType(current.achievement_type)

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        onClick={advance}
      >
        <motion.div
          key={currentIndex}
          initial={{ scale: 0.5, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.8, opacity: 0, y: -20 }}
          transition={{ type: "spring", damping: 20, stiffness: 300 }}
          className="mx-4 max-w-sm w-full rounded-2xl border border-white/20 bg-white/90 backdrop-blur-xl shadow-2xl p-8 text-center"
        >
          {/* Icon */}
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", damping: 12, stiffness: 200, delay: 0.1 }}
            className={`mx-auto mb-4 flex size-20 items-center justify-center rounded-full ${iconBg}`}
          >
            <Icon className={`size-10 ${iconColor}`} strokeWidth={1.5} />
          </motion.div>

          {/* Header */}
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2"
          >
            {header}
          </motion.p>

          {/* Title */}
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-xl font-semibold text-primary mb-2"
          >
            {current.title}
          </motion.h2>

          {/* Description */}
          {current.description && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-sm text-muted-foreground"
            >
              {current.description}
            </motion.p>
          )}

          {/* Progress dots */}
          {achievements.length > 1 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="flex items-center justify-center gap-1.5 mt-6"
            >
              {achievements.map((_, i) => (
                <div
                  key={i}
                  className={`size-2 rounded-full transition-colors ${
                    i === currentIndex ? "bg-primary" : "bg-primary/20"
                  }`}
                />
              ))}
            </motion.div>
          )}

          {/* Tap hint */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="text-xs text-muted-foreground/60 mt-4"
          >
            Tap to continue
          </motion.p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
