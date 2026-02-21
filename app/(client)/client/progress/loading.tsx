export default function ProgressLoading() {
  return (
    <div>
      {/* Page heading */}
      <div className="h-7 sm:h-8 w-28 bg-muted animate-pulse rounded-md mb-5" />

      {/* Summary stat cards — horizontal scroll on mobile, grid on desktop */}
      <div className="flex gap-2.5 overflow-x-auto pb-1 mb-6 -mx-1 px-1 scrollbar-none sm:grid sm:grid-cols-3 lg:grid-cols-5 sm:gap-3 sm:overflow-visible sm:mx-0 sm:px-0">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="bg-white rounded-xl border border-border p-3 sm:p-4 flex flex-col items-center text-center min-w-[90px] shrink-0 sm:shrink sm:min-w-0 sm:flex-row sm:text-left sm:items-center sm:gap-4"
          >
            <div className="size-8 sm:size-10 bg-muted animate-pulse rounded-full shrink-0" />
            <div className="mt-1.5 sm:mt-0 space-y-1">
              <div className="h-5 sm:h-7 w-8 bg-muted animate-pulse rounded-md mx-auto sm:mx-0" />
              <div className="h-3 sm:h-4 w-14 bg-muted animate-pulse rounded-md" />
            </div>
          </div>
        ))}
      </div>

      {/* Key Lifts heading */}
      <div className="h-5 sm:h-6 w-24 bg-muted animate-pulse rounded-md mb-3" />

      {/* Key Lift cards — horizontal scroll on mobile */}
      <div className="flex gap-3 overflow-x-auto pb-1 mb-6 -mx-1 px-1 scrollbar-none sm:grid sm:grid-cols-2 lg:grid-cols-3 sm:gap-4 sm:overflow-visible sm:mx-0 sm:px-0">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="min-w-[260px] shrink-0 sm:shrink sm:min-w-0 bg-white rounded-xl border border-border p-4 space-y-3"
          >
            <div className="h-4 w-32 bg-muted animate-pulse rounded-md" />
            <div className="flex items-center gap-4">
              <div className="space-y-1">
                <div className="h-3 w-16 bg-muted animate-pulse rounded-md" />
                <div className="h-6 w-12 bg-muted animate-pulse rounded-md" />
              </div>
              <div className="space-y-1">
                <div className="h-3 w-16 bg-muted animate-pulse rounded-md" />
                <div className="h-6 w-12 bg-muted animate-pulse rounded-md" />
              </div>
            </div>
            <div className="h-10 w-full bg-muted animate-pulse rounded-md" />
          </div>
        ))}
      </div>

      {/* Achievements link placeholder */}
      <div className="mb-6">
        <div className="h-10 w-48 bg-muted animate-pulse rounded-lg" />
      </div>

      {/* Recent Activity heading */}
      <div className="h-5 sm:h-6 w-36 bg-muted animate-pulse rounded-md mb-3" />

      {/* Activity rows */}
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="divide-y divide-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="px-3 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between gap-3"
            >
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="h-3 sm:h-4 w-36 bg-muted animate-pulse rounded-md" />
                <div className="h-2.5 sm:h-3 w-24 bg-muted animate-pulse rounded-md" />
              </div>
              <div className="h-3 w-14 bg-muted animate-pulse rounded-md shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
