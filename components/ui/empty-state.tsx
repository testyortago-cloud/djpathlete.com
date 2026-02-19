import type { LucideIcon } from "lucide-react"
import Link from "next/link"

interface EmptyStateProps {
  icon: LucideIcon
  heading: string
  description: string
  ctaLabel?: string
  ctaHref?: string
}

export function EmptyState({ icon: Icon, heading, description, ctaLabel, ctaHref }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="flex items-center justify-center size-16 rounded-2xl bg-primary/10 mb-6">
        <Icon className="size-8 text-primary" strokeWidth={1.5} />
      </div>
      <h3 className="text-lg font-semibold text-primary mb-2">{heading}</h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">{description}</p>
      {ctaLabel && ctaHref && (
        <Link
          href={ctaHref}
          className="inline-flex items-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {ctaLabel}
        </Link>
      )}
    </div>
  )
}
