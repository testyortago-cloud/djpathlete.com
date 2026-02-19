"use client"

import { Check } from "lucide-react"
import { motion } from "framer-motion"

interface Plan {
  name: string
  description: string
  price: number
  features: string[]
  highlighted?: boolean
}

const plans: Plan[] = [
  {
    name: "Foundation",
    description:
      "Structured training plans and performance tracking for athletes building their base.",
    price: 99,
    features: [
      "Personalized training plan",
      "Weekly performance tracking",
      "Basic nutrition guidance",
      "Monthly coach check-in",
    ],
  },
  {
    name: "Performance",
    description:
      "Advanced coaching with video analysis, nutrition planning, and ongoing coach support.",
    price: 199,
    highlighted: true,
    features: [
      "Everything in Foundation, plus…",
      "Video analysis and technique review",
      "Custom nutrition plan",
      "Weekly 1-on-1 coaching calls",
      "Strength & conditioning programming",
      "Recovery and mobility protocols",
    ],
  },
  {
    name: "Elite",
    description:
      "Full-service coaching for competitive athletes demanding peak performance.",
    price: 349,
    features: [
      "Everything in Performance, plus…",
      "Daily coach access and communication",
      "Competition preparation and peaking",
      "Sport psychology guidance",
      "In-season and off-season periodization",
      "Priority scheduling and support",
    ],
  },
]

export function PricingSection() {
  return (
    <section
      id="pricing"
      className="py-24 bg-surface"
    >
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="text-2xl sm:text-3xl lg:text-[40px] leading-tight font-semibold tracking-tight mb-4 text-primary">
            Coaching plans that grow with you.
          </h2>
          <p className="text-lg leading-7 text-muted-foreground max-w-2xl mx-auto">
            Start with the coaching level that fits your goals today. Upgrade anytime as your training demands evolve.
          </p>
        </motion.div>

        {/* Plan Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {plans.map((plan, index) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.5, delay: index * 0.15 }}
              className={`
                relative rounded-2xl p-8 flex flex-col border-2 transition-shadow
                ${
                  plan.highlighted
                    ? "border-primary bg-white shadow-lg"
                    : "border-border bg-white shadow-sm"
                }
              `}
            >
              {plan.highlighted && (
                <span className="absolute -top-3.5 left-6 bg-accent text-accent-foreground px-4 py-1 rounded-full text-sm font-medium">
                  Most Popular
                </span>
              )}

              {/* Plan name & description */}
              <div className="mb-6">
                <h3 className="text-2xl font-semibold text-primary mb-2">
                  {plan.name}
                </h3>
                <p className="text-[15px] leading-relaxed text-muted-foreground">
                  {plan.description}
                </p>
              </div>

              {/* Price */}
              <div className="mb-8">
                <div className="flex items-baseline gap-1">
                  <span className="text-5xl font-semibold text-primary">
                    ${plan.price}
                  </span>
                  <span className="text-lg text-muted-foreground ml-1">
                    / mo
                  </span>
                </div>
              </div>

              {/* CTA */}
              <a
                href="#contact"
                className="block w-full py-3 rounded-full text-center text-[15px] font-medium transition-all duration-200 bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
              >
                Get started
              </a>

              {/* Divider */}
              <div className="my-8 h-px bg-border" />

              {/* Features */}
              <ul className="space-y-4 flex-1">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <div className="mt-0.5 flex items-center justify-center size-5 rounded-full shrink-0 bg-primary/10">
                      <Check className="size-3 text-primary" strokeWidth={3} />
                    </div>
                    <span className="text-[15px] leading-snug text-foreground/70">
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
