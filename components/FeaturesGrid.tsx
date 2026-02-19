"use client"

import { motion } from "framer-motion"
import {
  ClipboardList,
  BarChart3,
  Video,
  Apple,
  Dumbbell,
  Heart,
  Users,
  MapPin,
} from "lucide-react"

const features = [
  {
    icon: ClipboardList,
    title: "Personalized Training Plans",
    description:
      "Custom workout programs designed for your sport, position, and goals. Periodized training that adapts as you progress and evolve as an athlete.",
  },
  {
    icon: BarChart3,
    title: "Performance Tracking",
    description:
      "Monitor speed, strength, endurance, and sport-specific metrics over time. Data-driven insights help you and your coach make informed training decisions.",
  },
  {
    icon: Video,
    title: "Video Analysis",
    description:
      "Upload game film and training footage for detailed technique review. Get frame-by-frame feedback from coaches to refine your mechanics and strategy.",
  },
  {
    icon: Apple,
    title: "Nutrition Coaching",
    description:
      "Personalized meal plans and nutrition guidance tailored to your training load, sport demands, and body composition goals for optimal fueling.",
  },
  {
    icon: Dumbbell,
    title: "Strength & Conditioning",
    description:
      "Structured strength programs designed to build power, speed, and injury resilience. Progressive overload protocols matched to your sport and season.",
  },
  {
    icon: Heart,
    title: "Recovery & Mobility",
    description:
      "Science-backed recovery protocols including mobility routines, sleep optimization, and active recovery strategies to keep you performing at your best.",
  },
  {
    icon: Users,
    title: "Team Coaching",
    description:
      "Group training programs for teams and athletic organizations. Coordinate training across athletes, track team-wide progress, and align coaching strategies.",
  },
  {
    icon: MapPin,
    title: "Remote & In-Person",
    description:
      "Train with DJP Athlete coaches in person or remotely. Our platform supports both virtual coaching and on-site training sessions for maximum flexibility.",
  },
]

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.08,
    },
  },
}

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.25, 0.1, 0.25, 1] as const },
  },
}

export function FeaturesGrid() {
  return (
    <section
      id="features"
      className="w-full py-16 lg:py-24 px-4 sm:px-8 bg-surface"
    >
      <div className="max-w-7xl mx-auto">
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="text-2xl sm:text-3xl lg:text-[40px] leading-tight font-semibold tracking-tight mb-4 text-primary">
            Coaching tools built for every stage of athletic development.
          </h2>
          <p className="text-lg leading-7 text-muted-foreground max-w-2xl mx-auto">
            Training plans, performance tracking, video analysis, and nutrition coaching — everything athletes need to train smarter and perform better.
          </p>
        </motion.div>

        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
        >
          {features.map((feature) => {
            const Icon = feature.icon
            return (
              <motion.div
                key={feature.title}
                variants={cardVariants}
                className="bg-white rounded-2xl border border-border/40 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden"
              >
                <div className="relative aspect-[16/10] overflow-hidden bg-surface flex items-center justify-center">
                  <Icon className="size-12 text-primary/60" strokeWidth={1.5} />
                </div>
                <div className="p-6">
                  <h3 className="text-lg font-semibold text-primary mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-[15px] leading-relaxed text-muted-foreground">
                    {feature.description}
                  </p>
                </div>
              </motion.div>
            )
          })}
        </motion.div>
      </div>
    </section>
  )
}
