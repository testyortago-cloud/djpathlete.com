"use client"

import { useState } from "react"

/** Clamped text with a more/less toggle. Clamps only when `text` is longer than `threshold` characters.
 *  Module scope (not defined inside a parent) so the toggle keeps its state across parent re-renders. */
export function ExpandableText({
  text,
  threshold,
  clampClassName = "line-clamp-2",
  className,
  more = "Show more",
  less = "Show less",
}: {
  text: string
  threshold: number
  clampClassName?: string
  className?: string
  more?: string
  less?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const long = text.length > threshold
  return (
    <div className={className}>
      <span className={!expanded && long ? clampClassName : "block"}>{text}</span>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-0.5 text-xs font-medium text-accent underline underline-offset-2 hover:text-primary"
        >
          {expanded ? less : more}
        </button>
      )}
    </div>
  )
}
