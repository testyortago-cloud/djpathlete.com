export default function ProgramDetailLoading() {
  return (
    <div>
      {/* Back link */}
      <div className="h-4 w-28 bg-muted animate-pulse rounded-md mb-3" />

      {/* Program heading */}
      <div className="h-7 sm:h-8 w-52 bg-muted animate-pulse rounded-md mb-2" />
      <div className="flex gap-2 mb-5">
        <div className="h-5 w-20 bg-muted animate-pulse rounded-full" />
        <div className="h-5 w-24 bg-muted animate-pulse rounded-full" />
      </div>

      {/* Week selector */}
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-9 w-20 bg-muted animate-pulse rounded-full shrink-0" />
        ))}
      </div>

      {/* Progress bar */}
      <div className="mb-5">
        <div className="flex justify-between mb-1">
          <div className="h-3 w-24 bg-muted animate-pulse rounded-md" />
          <div className="h-3 w-12 bg-muted animate-pulse rounded-md" />
        </div>
        <div className="h-2 w-full bg-muted animate-pulse rounded-full" />
      </div>

      {/* Day sections */}
      {Array.from({ length: 3 }).map((_, d) => (
        <div key={d} className="mb-5">
          <div className="h-5 w-24 bg-muted animate-pulse rounded-md mb-3" />
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, e) => (
              <div key={e} className="bg-white rounded-xl border border-border p-4 flex items-center gap-3">
                <div className="size-6 bg-muted animate-pulse rounded" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-4 w-36 bg-muted animate-pulse rounded-md" />
                  <div className="flex gap-3">
                    <div className="h-3 w-14 bg-muted animate-pulse rounded-md" />
                    <div className="h-3 w-14 bg-muted animate-pulse rounded-md" />
                    <div className="h-3 w-14 bg-muted animate-pulse rounded-md" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
