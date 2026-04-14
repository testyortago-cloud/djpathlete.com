interface NumberedFlowProps {
  steps: string[]
}

export function NumberedFlow({ steps }: NumberedFlowProps) {
  return (
    <div className="grid gap-4">
      {steps.map((step, i) => (
        <div key={step} className="flex items-start gap-4 rounded-2xl border border-border bg-background p-5 shadow-sm">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {i + 1}
          </div>
          <div className="pt-1 text-lg text-foreground">{step}</div>
        </div>
      ))}
    </div>
  )
}
