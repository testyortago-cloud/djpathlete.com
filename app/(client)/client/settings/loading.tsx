export default function SettingsLoading() {
  return (
    <div>
      <div className="h-7 sm:h-8 w-28 bg-muted animate-pulse rounded-md mb-5" />

      {/* Settings sections */}
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-border p-5 mb-4 space-y-4">
          <div className="flex items-center gap-2">
            <div className="size-5 bg-muted animate-pulse rounded" />
            <div className="h-5 w-36 bg-muted animate-pulse rounded-md" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Array.from({ length: 2 }).map((_, j) => (
              <div key={j} className="space-y-2">
                <div className="h-4 w-20 bg-muted animate-pulse rounded-md" />
                <div className="h-10 w-full bg-muted animate-pulse rounded-md" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
