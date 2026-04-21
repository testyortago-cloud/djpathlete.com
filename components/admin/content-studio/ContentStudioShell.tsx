import { GlobalSearch } from "./search/GlobalSearch"
import { UploadModal } from "./upload/UploadModal"
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
            <GlobalSearch />
            <UploadModal />
          </div>
        </div>
        <TabSwitcher />
      </div>
      <div className="flex-1 overflow-y-auto p-6">{children}</div>
    </div>
  )
}
