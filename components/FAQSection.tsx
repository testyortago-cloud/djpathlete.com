"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Plus } from "lucide-react"

type FAQItem = {
  question: string
  answer: string
}

type FAQSectionProps = {
  title?: string
  faqs?: FAQItem[]
}

const defaultFAQs: FAQItem[] = [
  {
    question: "What is DJP Athlete and how does the coaching program work?",
    answer:
      "DJP Athlete is an elite sports coaching platform that provides personalized training plans, performance tracking, video analysis, and nutrition guidance. We work with athletes at every level — from youth sports to professional competition — to help them reach their full potential through structured, science-backed coaching. After an initial assessment, we match you with a coaching plan and build a program tailored to your sport, goals, and schedule.",
  },
  {
    question: "What types of athletes does DJP Athlete work with?",
    answer:
      "We work with athletes across all levels and sports — youth athletes developing foundational skills, college athletes competing at the collegiate level, professional athletes optimizing peak performance, and recreational athletes pursuing personal fitness goals. Whether you play team sports, individual sports, or train for general fitness, our coaching adapts to your needs.",
  },
  {
    question: "How does performance tracking work?",
    answer:
      "Our performance tracking system monitors key metrics like speed, strength, endurance, and sport-specific skills over time. Athletes and coaches can review progress through dashboards, identify areas for improvement, and adjust training plans based on real data. You will see clear trends in your development and know exactly where you stand relative to your goals.",
  },
  {
    question: "Do you offer nutrition coaching as part of the program?",
    answer:
      "Yes. Every coaching tier includes nutrition guidance tailored to your sport, training load, and goals. Our Performance and Elite plans include fully personalized meal plans, macronutrient targets, and ongoing nutrition adjustments as your training evolves. We believe nutrition is a critical pillar of athletic performance and treat it accordingly.",
  },
  {
    question: "What is included in the video analysis service?",
    answer:
      "Our video analysis service lets you upload game film, practice footage, or training videos for detailed review by your coach. You will receive frame-by-frame breakdowns of your technique, annotated feedback, and specific drills to address areas for improvement. Video analysis is included in the Performance and Elite coaching tiers.",
  },
  {
    question: "Can I train remotely or do I need to be in person?",
    answer:
      "DJP Athlete supports both remote and in-person coaching. Our platform delivers training plans, video analysis, and performance tracking digitally, so you can train from anywhere. For athletes who prefer hands-on coaching, we also offer in-person sessions at select locations. Many athletes combine both approaches for maximum flexibility.",
  },
  {
    question: "How do I get started and what does pricing look like?",
    answer:
      "Getting started is simple — book a free consultation to discuss your goals and athletic background. We will recommend the right coaching tier for you. DJP Athlete offers three plans: Foundation at $99/month for personalized training and tracking, Performance at $199/month adding video analysis and weekly coaching calls, and Elite at $349/month for full-service coaching with daily access to your coach.",
  },
]

export const FAQSection = ({
  title = "Frequently asked questions",
  faqs = defaultFAQs,
}: FAQSectionProps) => {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const toggleFAQ = (index: number) => {
    setOpenIndex(openIndex === index ? null : index)
  }

  return (
    <section id="faq" className="w-full py-16 lg:py-24 px-4 sm:px-8 bg-white">
      <div className="max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-12 gap-16">
          {/* Left Column - Title */}
          <div className="lg:col-span-4">
            <h2 className="text-2xl sm:text-3xl lg:text-[40px] leading-tight font-semibold text-primary tracking-tight sticky top-24">
              {title}
            </h2>
          </div>

          {/* Right Column - FAQ Items */}
          <div className="lg:col-span-8">
            <div className="space-y-0">
              {faqs.map((faq, index) => (
                <div key={index} className="border-b border-border last:border-b-0">
                  <button
                    onClick={() => toggleFAQ(index)}
                    className="w-full flex items-center justify-between py-6 text-left group hover:opacity-70 transition-opacity duration-150"
                    aria-expanded={openIndex === index}
                  >
                    <span className="text-base sm:text-lg leading-6 sm:leading-7 text-primary pr-4 sm:pr-8">
                      {faq.question}
                    </span>
                    <motion.div
                      animate={{ rotate: openIndex === index ? 45 : 0 }}
                      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                      className="flex-shrink-0"
                    >
                      <Plus className="w-6 h-6 text-primary" strokeWidth={1.5} />
                    </motion.div>
                  </button>

                  <AnimatePresence initial={false}>
                    {openIndex === index && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="pb-6 pr-4 sm:pr-12">
                          <p className="text-lg leading-6 text-muted-foreground">
                            {faq.answer}
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
