import { cn } from "@/lib/utils"

type Variant = "active" | "recovering" | "resolved" | "pr" | "neutral"

const VARIANT_CLASSES: Record<Variant, string> = {
  active: "bg-error/10 text-error border-error/30",
  recovering: "bg-warning/10 text-warning border-warning/30",
  resolved: "bg-success/10 text-success border-success/30",
  pr: "bg-accent/15 text-accent-foreground border-accent/40",
  neutral: "bg-muted text-muted-foreground border-border",
}

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const variant = (
    ["active", "recovering", "resolved", "pr", "neutral"].includes(status) ? status : "neutral"
  ) as Variant
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide",
        VARIANT_CLASSES[variant],
      )}
    >
      {label ?? status}
    </span>
  )
}
