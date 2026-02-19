"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { ArrowRight } from "lucide-react"

type StatItem = {
  value: string
  description: string
  delay: number
}

const stats: StatItem[] = [
  {
    value: "500+",
    description: "Athletes trained\nand counting",
    delay: 0.2,
  },
  {
    value: "15+",
    description: "Coaching programs\nacross sports",
    delay: 0.4,
  },
  {
    value: "98%",
    description: "Client satisfaction\nrating",
    delay: 0.6,
  },
  {
    value: "40%",
    description: "Average performance\nimprovement",
    delay: 0.8,
  },
]

export const BankingScaleHero = () => {
  const [isVisible, setIsVisible] = useState(false)
  const [typingComplete, setTypingComplete] = useState(false)

  useEffect(() => {
    setIsVisible(true)
    const timer = setTimeout(() => setTypingComplete(true), 1000)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div id="overview" className="w-full overflow-hidden bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-8 py-16 lg:py-24 pt-12 lg:pt-16">
        <div className="grid grid-cols-12 gap-5 gap-y-16 items-start">
          <div className="col-span-12 md:col-span-6 relative z-10">
            <div className="relative h-6 inline-flex items-center font-mono uppercase text-xs mb-12 px-2 text-primary">
              <div className="flex items-center gap-0.5 overflow-hidden">
                <motion.span
                  initial={{ width: 0 }}
                  animate={{ width: "auto" }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                  className="block whitespace-nowrap overflow-hidden relative z-10"
                >
                  Built for athletes & coaches
                </motion.span>
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: typingComplete ? [1, 0, 1, 0] : 0 }}
                  transition={{ duration: 1, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
                  className="block w-1.5 h-3 ml-0.5 relative z-10 rounded-sm bg-primary"
                />
              </div>
            </div>

            <h2 className="text-2xl sm:text-3xl lg:text-[40px] font-semibold leading-tight tracking-tight text-primary mb-4 lg:mb-6">
              Elite coaching and performance training{" "}
              <span className="opacity-40">
                that scales from youth sports to professional competition.
              </span>
            </h2>

            <p className="text-lg leading-6 text-primary opacity-60 mt-0 mb-6">
              Personalized training plans, performance analytics, and expert coaching in one place. Whether you are a youth athlete, college competitor, or professional,
              DJP Athlete gives you the tools and guidance to reach your full potential.
            </p>

            <a
              href="#features"
              className="relative inline-flex justify-center items-center leading-4 text-center cursor-pointer whitespace-nowrap outline-none font-medium h-9 text-foreground bg-white/50 backdrop-blur-sm shadow-[0_1px_1px_0_rgba(255,255,255,0),0_0_0_1px_rgba(87,90,100,0.12)] transition-all duration-200 ease-in-out rounded-lg px-4 mt-5 text-sm group hover:shadow-[0_1px_2px_0_rgba(0,0,0,0.05),0_0_0_1px_rgba(87,90,100,0.18)]"
            >
              <span className="relative z-10 flex items-center gap-1">
                See how it works
                <ArrowRight className="w-4 h-4 -mr-1 transition-transform duration-150 group-hover:translate-x-1" />
              </span>
            </a>
          </div>

          <motion.div
            className="col-span-12 md:col-span-6 pt-0 md:pt-[4.5rem]"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <div
              className="relative w-full aspect-video max-h-[416px] rounded-xl overflow-hidden shadow-lg"
              style={{
                backgroundImage: "url(https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=1200&auto=format&fit=crop&q=80)",
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            />
          </motion.div>

          <div className="col-span-12">
            <div className="overflow-visible pb-5">
              <div className="grid grid-cols-12 gap-5 relative z-10">
                {stats.map((stat, index) => (
                  <div key={index} className="col-span-6 md:col-span-3">
                    <motion.div
                      initial={{ opacity: 0, y: 20, filter: "blur(4px)" }}
                      animate={
                        isVisible
                          ? {
                              opacity: [0, 1, 1],
                              y: [20, 0, 0],
                              filter: ["blur(4px)", "blur(0px)", "blur(0px)"],
                            }
                          : {}
                      }
                      transition={{ duration: 1.5, delay: stat.delay, ease: [0.1, 0, 0.1, 1] }}
                      className="flex flex-col gap-2"
                    >
                      <span className="text-2xl font-medium leading-[26.4px] tracking-tight text-primary">
                        {stat.value}
                      </span>
                      <p className="text-xs leading-[13.2px] text-muted-foreground m-0 whitespace-pre-line">
                        {stat.description}
                      </p>
                    </motion.div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
