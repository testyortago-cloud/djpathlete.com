import { Zap, Timer, Target, Users, type LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"

export interface FocusItem {
  title: string
  body: string
}

interface FocusGridProps {
  items: FocusItem[]
}

const ICONS: LucideIcon[] = [Zap, Timer, Target, Users]

export function FocusGrid({ items }: FocusGridProps) {
  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item, i) => {
        const Icon = ICONS[i % ICONS.length]
        const number = String(i + 1).padStart(2, "0")
        return (
          <Card
            key={item.title}
            className="h-full border-border bg-background rounded-2xl shadow-sm"
          >
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" strokeWidth={1.8} />
                </div>
                <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                  {number}
                </div>
              </div>
              <h3 className="mt-5 text-2xl font-heading font-semibold tracking-tight text-foreground">
                {item.title}
              </h3>
              <p className="mt-4 leading-7 text-muted-foreground">{item.body}</p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
