import { Upload, Search } from "lucide-react"
import { TabSwitcher } from "./TabSwitcher"

export function ContentStudioShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-6 pb-0 border-b border-border bg-background">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="font-heading text-2xl">Content Studio</h1>
            <p className="text-sm text-muted-foreground">
              Videos, posts, and scheduling in one place.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type="search"
                placeholder="Search videos, transcripts, posts..."
                disabled
                className="pl-9 pr-3 py-2 text-sm rounded-md border border-border bg-muted/30 w-80 placeholder:text-muted-foreground/60 disabled:cursor-not-allowed"
              />
            </div>
            <button
              type="button"
              disabled
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Upload className="size-4" />
              Upload Video
            </button>
          </div>
        </div>
        <TabSwitcher />
      </div>
      <div className="flex-1 overflow-y-auto p-6">{children}</div>
    </div>
  )
}
