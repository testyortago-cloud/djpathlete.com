"use client"
import { motion } from "framer-motion"

type ProductTeaserCardProps = {
  headline?: string
  subheadline?: string
  description?: string
  primaryButtonText?: string
  primaryButtonHref?: string
}

export const ProductTeaserCard = (props: ProductTeaserCardProps) => {
  const {
    headline = "Elite coaching that athletes actually want to train with.",
    subheadline = "The all-in-one athletic performance platform with personalized training plans, performance tracking, and video analysis — built by coaches, for athletes.",
    description = "Trusted by athletes worldwide, DJP Athlete powers performance training and coaching — with customized programs, nutrition guidance, and data-driven progress tracking.",
    primaryButtonText = "Get started",
    primaryButtonHref = "#pricing",
  } = props

  return (
    <section id="home" className="w-full px-4 sm:px-8 pt-24 lg:pt-32 pb-10 lg:pb-16">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-12 gap-0 lg:gap-2">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, ease: [0.645, 0.045, 0.355, 1] }}
            className="col-span-12 lg:col-span-6 rounded-t-3xl lg:rounded-[40px] p-6 sm:p-10 lg:p-16 flex flex-col justify-end lg:aspect-square overflow-hidden bg-surface"
          >
            <h1 className="text-3xl sm:text-4xl lg:text-[56px] lg:leading-[60px] leading-tight tracking-tight text-primary max-w-[520px] mb-4 lg:mb-6 font-semibold">
              {headline}
            </h1>

            <p className="text-base sm:text-lg leading-6 sm:leading-7 text-foreground/70 max-w-[520px] mb-4 lg:mb-6">
              {subheadline}
            </p>

            <div className="max-w-[520px] mb-0">
              <p className="text-base leading-5" style={{ display: "none" }}>
                {description}
              </p>
            </div>

            <div className="mt-6 lg:mt-10">
              <a
                href={primaryButtonHref}
                className="inline-block cursor-pointer text-primary-foreground bg-primary rounded-full px-[18px] py-[15px] text-base leading-4 whitespace-nowrap transition-all duration-150 ease-[cubic-bezier(0.455,0.03,0.515,0.955)] hover:rounded-2xl hover:bg-primary/90"
              >
                {primaryButtonText}
              </a>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, ease: [0.645, 0.045, 0.355, 1], delay: 0.2 }}
            className="col-span-12 lg:col-span-6 bg-white rounded-b-3xl lg:rounded-[40px] flex justify-center items-center aspect-[5/2] sm:aspect-[3/1] lg:aspect-square overflow-hidden"
            style={{
              backgroundImage: "url(https://images.unsplash.com/photo-1517963879433-6ad2b056d712?w=1200&auto=format&fit=crop&q=80)",
              backgroundSize: "cover",
              backgroundPosition: "center",
              backgroundRepeat: "no-repeat",
            }}
          />
        </div>
      </div>
    </section>
  )
}
