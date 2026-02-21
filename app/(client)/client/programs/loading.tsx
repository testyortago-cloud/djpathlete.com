export default function ProgramsLoading() {
  return (
    <div>
      {/* Page heading */}
      <div className="h-7 sm:h-8 w-32 bg-muted animate-pulse rounded-md mb-5" />

      {/* Section heading */}
      <div className="h-5 sm:h-6 w-28 bg-muted animate-pulse rounded-md mb-3" />

      {/* Program cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-white rounded-xl border border-border p-4 sm:p-5 flex flex-col space-y-3"
          >
            {/* Badges */}
            <div className="flex flex-wrap gap-1.5">
              <div className="h-5 w-20 bg-muted animate-pulse rounded-full" />
              <div className="h-5 w-20 bg-muted animate-pulse rounded-full" />
            </div>
            {/* Title */}
            <div className="h-4 sm:h-5 w-44 bg-muted animate-pulse rounded-md" />
            {/* Description */}
            <div className="space-y-1.5">
              <div className="h-3 sm:h-4 w-full bg-muted animate-pulse rounded-md" />
              <div className="h-3 sm:h-4 w-3/4 bg-muted animate-pulse rounded-md" />
            </div>
            {/* Footer */}
            <div className="pt-3 border-t border-border flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-3 w-12 bg-muted animate-pulse rounded-md" />
                <div className="h-3 w-14 bg-muted animate-pulse rounded-md" />
              </div>
              <div className="h-4 w-14 bg-muted animate-pulse rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
