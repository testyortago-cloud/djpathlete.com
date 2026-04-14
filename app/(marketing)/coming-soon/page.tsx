import type { Metadata } from "next"
import { Clock } from "lucide-react"

export const metadata: Metadata = {
  title: "Coming Soon",
  description: "Something new is on the way. Stay tuned for exciting updates from DJP Athlete.",
}

export default function ComingSoonPage() {
  return (
    <section className="min-h-[70vh] flex items-center justify-center px-4 sm:px-8">
      <div className="max-w-lg mx-auto text-center">
        <div className="flex justify-center mb-6">
          <div className="size-16 rounded-full bg-accent/10 flex items-center justify-center">
            <Clock className="size-7 text-accent" />
          </div>
        </div>
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="h-px w-12 bg-accent" />
          <p className="text-sm font-medium text-accent uppercase tracking-widest">Stay Tuned</p>
          <div className="h-px w-12 bg-accent" />
        </div>
        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-semibold text-primary tracking-tight mb-4">
          Coming Soon
        </h1>
        <p className="text-base sm:text-lg text-muted-foreground leading-relaxed">
          Something new is in the works. Check back soon for exciting updates.
        </p>
      </div>
    </section>
  )
}
