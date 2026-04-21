import { Sparkles } from "lucide-react"

interface TabPlaceholderProps {
  tabName: string
  phaseLabel: string
}

export function TabPlaceholder({ tabName, phaseLabel }: TabPlaceholderProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <Sparkles className="size-10 text-muted-foreground mb-3" strokeWidth={1.5} />
      <h3 className="font-heading text-xl mb-1">{tabName}</h3>
      <p className="text-sm text-muted-foreground max-w-md">
        Lands in {phaseLabel}. The shell is in place — real UI is next.
      </p>
    </div>
  )
}
