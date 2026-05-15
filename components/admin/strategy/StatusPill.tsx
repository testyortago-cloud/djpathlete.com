interface Props {
  status: string
}

const TONES: Record<string, string> = {
  draft: "bg-warning/10 text-warning",
  approved: "bg-success/10 text-success",
  rejected: "bg-error/10 text-error",
  ok: "bg-success/10 text-success",
  failed: "bg-error/10 text-error",
}

export function StatusPill({ status }: Props) {
  const tone = TONES[status] ?? "bg-surface text-muted-foreground"
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {status}
    </span>
  )
}
