"use client"

import type { ReactNode } from "react"
import { HelpCircle } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

interface HelpTooltipProps {
  label: ReactNode
  children: ReactNode
  className?: string
}

/**
 * Label with a help icon that reveals `children` on hover/focus. Use around
 * any metric name, column header, or status pill where a brief explanation
 * would save the coach from guessing.
 *
 * The label is rendered inline; the icon sits to its right.
 */
export function HelpTooltip({ label, children, className }: HelpTooltipProps) {
  return (
    <TooltipProvider>
      <span className={cn("inline-flex items-center gap-1", className)}>
        <span>{label}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="More info"
              className="inline-flex items-center text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:text-primary"
            >
              <HelpCircle className="size-3.5" strokeWidth={1.75} />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">{children}</TooltipContent>
        </Tooltip>
      </span>
    </TooltipProvider>
  )
}
