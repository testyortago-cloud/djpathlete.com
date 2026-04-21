import { FileText } from "lucide-react"

export function DrawerPostOnlyHeader() {
  return (
    <div className="border-b border-border bg-surface/40 px-6 py-10">
      <div className="rounded-lg border-2 border-dashed border-border bg-background/60 py-10 flex flex-col items-center text-center">
        <FileText className="size-8 text-muted-foreground mb-2" strokeWidth={1.5} />
        <h2 className="font-heading text-lg text-primary">Manual post</h2>
        <p className="text-sm text-muted-foreground max-w-sm mt-1">
          No source video — this post was created directly or its source video has been deleted.
        </p>
      </div>
    </div>
  )
}
