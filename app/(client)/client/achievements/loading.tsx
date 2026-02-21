export default function AchievementsLoading() {
  return (
    <div>
      {/* Back link */}
      <div className="h-4 w-28 bg-muted animate-pulse rounded-md mb-3" />

      {/* Page heading */}
      <div className="h-7 sm:h-8 w-40 bg-muted animate-pulse rounded-md mb-5" />

      {/* Stats Summary — 3 columns */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-4 mb-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="bg-white rounded-xl border border-border p-3 sm:p-4 flex flex-col items-center text-center sm:flex-row sm:text-left sm:items-center gap-2 sm:gap-4"
          >
            <div className="size-9 sm:size-10 bg-muted animate-pulse rounded-full shrink-0" />
            <div className="space-y-1">
              <div className="h-6 sm:h-7 w-8 bg-muted animate-pulse rounded-md mx-auto sm:mx-0" />
              <div className="h-3 sm:h-4 w-12 bg-muted animate-pulse rounded-md" />
            </div>
          </div>
        ))}
      </div>

      {/* Filter tabs placeholder */}
      <div className="flex gap-2 mb-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-8 w-20 bg-muted animate-pulse rounded-full"
          />
        ))}
      </div>

      {/* Achievement cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="bg-white rounded-xl border border-border p-4 flex items-start gap-3"
          >
            <div className="size-10 bg-muted animate-pulse rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-32 bg-muted animate-pulse rounded-md" />
              <div className="h-3 w-full bg-muted animate-pulse rounded-md" />
              <div className="h-3 w-20 bg-muted animate-pulse rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
