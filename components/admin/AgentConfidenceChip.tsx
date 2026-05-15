"use client"

interface Props {
  confidence: number | null
}

export function AgentConfidenceChip({ confidence }: Props) {
  if (confidence == null) {
    return <span className="rounded bg-muted px-2 py-0.5 text-xs">—</span>
  }
  const tone =
    confidence >= 7
      ? "bg-success/20 text-success"
      : confidence >= 4
        ? "bg-warning/20 text-warning"
        : "bg-error/20 text-error"
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${tone}`}>
      conf {confidence}/10
    </span>
  )
}

interface DissentProps {
  dissents: boolean
  reason: string | null
}

export function AgentDissentBadge({ dissents, reason }: DissentProps) {
  if (!dissents) return null
  return (
    <span
      className="rounded bg-accent/20 px-2 py-0.5 text-xs text-accent"
      title={reason ?? ""}
    >
      dissents
    </span>
  )
}
