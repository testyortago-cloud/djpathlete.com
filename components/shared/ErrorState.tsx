"use client"

import Link from "next/link"
import { AlertTriangle, Compass, Home, RefreshCw, Search } from "lucide-react"
import { Button } from "@/components/ui/button"

type Variant = "error" | "not-found" | "forbidden"

interface ErrorStateProps {
  variant?: Variant
  title?: string
  description?: string
  /** Render as a full-screen centered hero (true) or as an embedded panel (false). Defaults to true. */
  fullPage?: boolean
  /** "Try again" handler. When provided, shows a Try Again button. */
  onReset?: () => void
  /** Where the "Go home" / primary action button links. Defaults to "/". */
  homeHref?: string
  /** Label for the home button. Defaults based on variant. */
  homeLabel?: string
  /** Hides the home button entirely. */
  hideHomeButton?: boolean
  /** Optional digest from Next.js error boundary — surfaced for support tickets. */
  digest?: string
}

const VARIANT_DEFAULTS: Record<
  Variant,
  { title: string; description: string; icon: React.ComponentType<{ className?: string }> }
> = {
  error: {
    title: "Something went wrong",
    description:
      "We hit an unexpected snag loading this page. Try again, or head back home — your data is safe.",
    icon: AlertTriangle,
  },
  "not-found": {
    title: "We couldn't find that page",
    description:
      "The link may be broken, or the page may have moved. Try one of the suggestions below to get back on track.",
    icon: Compass,
  },
  forbidden: {
    title: "You don't have access to this page",
    description:
      "Your account doesn't have permission to view this. If you think this is wrong, reach out to support.",
    icon: Search,
  },
}

export function ErrorState({
  variant = "error",
  title,
  description,
  fullPage = true,
  onReset,
  homeHref = "/",
  homeLabel,
  hideHomeButton = false,
  digest,
}: ErrorStateProps) {
  const defaults = VARIANT_DEFAULTS[variant]
  const Icon = defaults.icon
  const heading = title ?? defaults.title
  const body = description ?? defaults.description
  const cta = homeLabel ?? (variant === "not-found" ? "Back to home" : "Go home")

  const content = (
    <div className="text-center max-w-md mx-auto">
      <div
        className={`mx-auto mb-6 flex size-16 items-center justify-center rounded-full ${
          variant === "not-found" ? "bg-primary/10" : "bg-destructive/10"
        }`}
      >
        <Icon className={`size-8 ${variant === "not-found" ? "text-primary" : "text-destructive"}`} />
      </div>
      <h1 className="text-2xl sm:text-3xl font-heading font-semibold text-foreground mb-2">{heading}</h1>
      <p className="text-muted-foreground font-body mb-8">{body}</p>
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        {onReset && (
          <Button onClick={onReset} className="rounded-full px-6">
            <RefreshCw className="size-4 mr-2" />
            Try again
          </Button>
        )}
        {!hideHomeButton && (
          <Button asChild variant={onReset ? "outline" : "default"} className="rounded-full px-6">
            <Link href={homeHref}>
              <Home className="size-4 mr-2" />
              {cta}
            </Link>
          </Button>
        )}
      </div>
      {digest && (
        <p className="mt-6 text-xs text-muted-foreground/70 font-mono">
          Error reference: <span className="select-all">{digest}</span>
        </p>
      )}
    </div>
  )

  if (!fullPage) {
    return <div className="rounded-xl border border-border bg-white p-8">{content}</div>
  }

  return <div className="min-h-[60vh] flex items-center justify-center px-6 py-16">{content}</div>
}
