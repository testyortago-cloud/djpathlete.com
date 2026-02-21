export default function PaymentsLoading() {
  return (
    <div>
      {/* Page heading */}
      <div className="h-7 sm:h-8 w-44 bg-muted animate-pulse rounded-md mb-5" />

      {/* Summary Cards — 2 columns */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-6">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="bg-white rounded-xl border border-border p-3 sm:p-4 flex flex-col items-center text-center sm:flex-row sm:text-left sm:items-center gap-2 sm:gap-4"
          >
            <div className="size-9 sm:size-10 bg-muted animate-pulse rounded-full shrink-0" />
            <div className="space-y-1">
              <div className="h-5 sm:h-7 w-14 bg-muted animate-pulse rounded-md mx-auto sm:mx-0" />
              <div className="h-3 sm:h-4 w-20 bg-muted animate-pulse rounded-md" />
            </div>
          </div>
        ))}
      </div>

      {/* Payments list — mobile cards */}
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="divide-y divide-border">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3 mb-1.5">
                <div className="h-4 w-36 bg-muted animate-pulse rounded-md" />
                <div className="h-5 w-16 bg-muted animate-pulse rounded-full shrink-0" />
              </div>
              <div className="flex items-center justify-between">
                <div className="h-3 w-20 bg-muted animate-pulse rounded-md" />
                <div className="h-4 w-14 bg-muted animate-pulse rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
