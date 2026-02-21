export default function DashboardLoading() {
  return (
    <div>
      {/* Welcome heading */}
      <div className="h-7 sm:h-8 w-56 bg-muted animate-pulse rounded-md mb-5" />

      {/* Questionnaire banner placeholder */}
      <div className="rounded-xl border border-border bg-muted/30 animate-pulse p-4 mb-6 flex items-center gap-4">
        <div className="size-10 rounded-full bg-muted animate-pulse shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-44 bg-muted animate-pulse rounded-md" />
          <div className="h-3 w-64 bg-muted animate-pulse rounded-md" />
        </div>
        <div className="h-4 w-12 bg-muted animate-pulse rounded-md shrink-0" />
      </div>

      {/* Stats Row — 3 columns */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="bg-white rounded-xl border border-border p-3 sm:p-4 flex flex-col items-center text-center sm:flex-row sm:text-left sm:items-center gap-2 sm:gap-4"
          >
            <div className="size-9 sm:size-10 bg-muted animate-pulse rounded-full shrink-0" />
            <div className="space-y-1.5">
              <div className="h-6 sm:h-7 w-8 bg-muted animate-pulse rounded-md mx-auto sm:mx-0" />
              <div className="h-3 sm:h-4 w-16 bg-muted animate-pulse rounded-md" />
            </div>
          </div>
        ))}
      </div>

      {/* Active Programs heading */}
      <div className="h-6 w-36 bg-muted animate-pulse rounded-md mb-4" />

      {/* Program cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="bg-white rounded-xl border border-border p-4 sm:p-6 space-y-3"
          >
            {/* Title */}
            <div className="h-4 sm:h-5 w-40 bg-muted animate-pulse rounded-md" />
            {/* Badges */}
            <div className="flex gap-1.5">
              <div className="h-5 w-20 bg-muted animate-pulse rounded-full" />
              <div className="h-5 w-20 bg-muted animate-pulse rounded-full" />
            </div>
            {/* Description */}
            <div className="space-y-1.5">
              <div className="h-3 sm:h-4 w-full bg-muted animate-pulse rounded-md" />
              <div className="h-3 sm:h-4 w-3/4 bg-muted animate-pulse rounded-md" />
            </div>
            {/* Progress bar */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="h-3 w-16 bg-muted animate-pulse rounded-md" />
                <div className="h-3 w-24 bg-muted animate-pulse rounded-md" />
              </div>
              <div className="h-1.5 sm:h-2 w-full bg-muted animate-pulse rounded-full" />
            </div>
            {/* Footer */}
            <div className="flex items-center justify-between">
              <div className="h-3 w-24 bg-muted animate-pulse rounded-md" />
              <div className="h-4 w-24 bg-muted animate-pulse rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
