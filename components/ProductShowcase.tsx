"use client"

import { motion } from "framer-motion"

export const ProductShowcase = () => {
  return (
    <section className="w-full px-4 sm:px-8 py-16 lg:py-24 bg-surface">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-12 gap-8 lg:gap-12 items-center">
          {/* Image left */}
          <motion.div
            className="col-span-12 lg:col-span-7"
            initial={{ opacity: 0, x: -24 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <div
              className="w-full aspect-[16/10] rounded-2xl shadow-[0_8px_40px_-12px_rgba(0,0,0,0.12)]"
              style={{
                backgroundImage: "url(https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=1200&auto=format&fit=crop&q=80)",
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            />
          </motion.div>

          {/* Text right */}
          <motion.div
            className="col-span-12 lg:col-span-5"
            initial={{ opacity: 0, x: 24 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, delay: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <h2 className="text-2xl sm:text-3xl lg:text-[40px] font-semibold leading-tight tracking-tight text-primary mb-4 lg:mb-6">
              Your coaching dashboard{" "}
              <span className="opacity-40">for training plans and performance tracking.</span>
            </h2>

            <p className="text-lg leading-7 text-muted-foreground mb-8">
              Visualize your entire athletic program — from training schedules and performance metrics to nutrition plans and recovery protocols — all in one real-time dashboard.
            </p>

            <a
              href="#pricing"
              className="inline-block cursor-pointer text-primary-foreground bg-primary rounded-full px-[18px] py-[15px] text-base leading-4 whitespace-nowrap transition-all duration-150 ease-[cubic-bezier(0.455,0.03,0.515,0.955)] hover:rounded-2xl hover:bg-primary/90"
            >
              Start your journey
            </a>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
