"use client"

import { motion } from "framer-motion"

const segments = [
  {
    image: "https://images.unsplash.com/photo-1461896836934-bd45ba8fcf9b?w=800&auto=format&fit=crop&q=80",
    title: "Youth Athletes",
    description:
      "Building strong foundations starts early. DJP Athlete helps young athletes develop proper movement patterns, sport-specific skills, and a love for training — with age-appropriate programs designed to build confidence and prevent injury.",
  },
  {
    image: "https://images.unsplash.com/photo-1541534741688-6078c6bfb5c5?w=800&auto=format&fit=crop&q=80",
    title: "College Athletes",
    description:
      "Competing at the collegiate level demands elite preparation. Our coaching programs help college athletes maximize their performance with structured strength and conditioning, sport-specific training, and nutrition plans built for their competitive schedule.",
  },
  {
    image: "https://images.unsplash.com/photo-1526676037777-05a232554f77?w=800&auto=format&fit=crop&q=80",
    title: "Professional Athletes",
    description:
      "At the professional level, marginal gains make the difference. DJP Athlete provides advanced performance analytics, periodized training, video analysis, and recovery optimization to help pros stay at the top of their game.",
  },
  {
    image: "https://images.unsplash.com/photo-1486218119243-13883505764c?w=800&auto=format&fit=crop&q=80",
    title: "Weekend Warriors",
    description:
      "You do not have to be a pro to train like one. DJP Athlete offers recreational athletes structured programs to improve fitness, prevent injuries, and hit personal goals — whether you are training for a marathon, obstacle race, or just a healthier lifestyle.",
  },
]

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1,
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

export function WhoItsFor() {
  return (
    <section id="who-its-for" className="w-full py-16 lg:py-24 px-4 sm:px-8 bg-white">
      <div className="max-w-7xl mx-auto">
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="text-2xl sm:text-3xl lg:text-[40px] leading-tight font-semibold tracking-tight mb-4 text-primary">
            Coaching programs for every level of athlete.
          </h2>
          <p className="text-lg leading-7 text-muted-foreground max-w-2xl mx-auto">
            Whether you are a youth athlete just starting out, a college competitor, a seasoned professional, or a weekend warrior chasing personal goals, DJP Athlete adapts to your level.
          </p>
        </motion.div>

        <motion.div
          className="grid grid-cols-1 md:grid-cols-2 gap-8"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
        >
          {segments.map((segment) => (
            <motion.div
              key={segment.title}
              variants={cardVariants}
              className="rounded-2xl border border-border/40 bg-surface hover:bg-white hover:shadow-md transition-all duration-200 overflow-hidden"
            >
              <div className="aspect-[16/9] overflow-hidden">
                <img
                  src={segment.image}
                  alt={segment.title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
              <div className="p-8">
                <h3 className="text-xl font-semibold text-primary mb-3">
                  {segment.title}
                </h3>
                <p className="text-[15px] leading-relaxed text-muted-foreground">
                  {segment.description}
                </p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
