export default function AdminFormReviewsLoading() {
  return (
    <div>
      {/* Heading */}
      <div className="h-7 sm:h-8 w-44 bg-muted animate-pulse rounded-md mb-5" />

      {/* Filter tabs */}
      <div className="flex gap-2 mb-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 w-24 bg-muted animate-pulse rounded-full" />
        ))}
      </div>

      {/* Review items */}
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-border p-4 flex items-center gap-4">
            <div className="size-10 bg-muted animate-pulse rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-48 bg-muted animate-pulse rounded-md" />
              <div className="h-3 w-36 bg-muted animate-pulse rounded-md" />
            </div>
            <div className="h-3 w-16 bg-muted animate-pulse rounded-md hidden sm:block" />
          </div>
        ))}
      </div>
    </div>
  )
}
