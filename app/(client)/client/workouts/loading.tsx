export default function WorkoutsLoading() {
  return (
    <div>
      {/* Heading */}
      <div className="h-7 sm:h-8 w-36 bg-muted animate-pulse rounded-md mb-5" />

      {/* Day tabs */}
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-9 w-24 bg-muted animate-pulse rounded-full shrink-0" />
        ))}
      </div>

      {/* Exercise cards */}
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="h-5 w-40 bg-muted animate-pulse rounded-md" />
              <div className="size-6 bg-muted animate-pulse rounded" />
            </div>
            {/* Video placeholder */}
            <div className="h-40 w-full bg-muted animate-pulse rounded-lg" />
            {/* Sets/reps/rest */}
            <div className="flex gap-4">
              <div className="h-4 w-16 bg-muted animate-pulse rounded-md" />
              <div className="h-4 w-16 bg-muted animate-pulse rounded-md" />
              <div className="h-4 w-16 bg-muted animate-pulse rounded-md" />
            </div>
            {/* Log button */}
            <div className="h-9 w-full bg-muted animate-pulse rounded-md" />
          </div>
        ))}
      </div>
    </div>
  )
}
