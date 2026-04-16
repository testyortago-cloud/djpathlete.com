import Link from "next/link"

export function ComingSoon() {
  return (
    <section className="pt-32 pb-24 lg:pt-40 lg:pb-32 px-4 sm:px-8">
      <div className="max-w-3xl mx-auto text-center">
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="h-px w-12 bg-accent" />
          <p className="text-sm font-medium text-accent uppercase tracking-widest">Shop</p>
          <div className="h-px w-12 bg-accent" />
        </div>

        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-heading font-semibold text-primary tracking-tight mb-6">
          Coming Soon
        </h1>

        <p className="text-lg text-muted-foreground font-body leading-relaxed mb-10 max-w-xl mx-auto">
          Performance gear is being prepped. DJP Athlete apparel and training accessories are on
          their way — check back soon.
        </p>

        <Link
          href="/"
          className="inline-flex items-center gap-2 bg-primary text-white font-medium px-8 py-3 rounded-full hover:opacity-90 transition-opacity"
        >
          Back to Home
        </Link>
      </div>
    </section>
  )
}
