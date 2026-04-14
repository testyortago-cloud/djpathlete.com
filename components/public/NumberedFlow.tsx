interface NumberedFlowProps {
  steps: string[]
}

export function NumberedFlow({ steps }: NumberedFlowProps) {
  return (
    <ol className="relative space-y-5">
      {/* Connector rail */}
      <div
        aria-hidden
        className="absolute left-[22px] top-3 bottom-3 w-px bg-gradient-to-b from-accent/40 via-border to-border"
      />
      {steps.map((step, i) => (
        <li key={step} className="relative flex items-start gap-5">
          <div className="relative z-10 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <span className="font-mono text-xs font-semibold tabular-nums tracking-wider">
              {String(i + 1).padStart(2, "0")}
            </span>
          </div>
          <div className="flex-1 rounded-2xl border border-border bg-background px-5 py-4 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <p className="text-base md:text-lg leading-snug text-foreground">{step}</p>
              <div
                aria-hidden
                className="hidden md:block h-px w-12 bg-accent/60 shrink-0"
              />
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}
