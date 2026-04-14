export default function FormReviewsLoading() {
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="h-7 sm:h-8 w-40 bg-muted animate-pulse rounded-md" />
        <div className="h-9 w-28 bg-muted animate-pulse rounded-lg" />
      </div>

      {/* Cards */}
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-border p-4 flex items-start gap-3">
            <div className="size-10 bg-muted animate-pulse rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-48 bg-muted animate-pulse rounded-md" />
              <div className="h-3 w-32 bg-muted animate-pulse rounded-md" />
              <div className="h-3 w-20 bg-muted animate-pulse rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
