export default function EventsLoading() {
  return (
    <div>
      <div className="h-8 w-24 bg-muted animate-pulse rounded-md mb-6" />

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          <div className="h-9 w-48 bg-muted animate-pulse rounded-lg" />
          <div className="h-9 w-40 bg-muted animate-pulse rounded-lg" />
          <div className="h-9 w-40 bg-muted animate-pulse rounded-lg" />
        </div>
        <div className="h-9 w-28 bg-muted animate-pulse rounded-lg" />
      </div>

      {/* Table rows */}
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="border-b border-border bg-surface/50 px-4 py-3">
          <div className="h-4 w-full bg-muted animate-pulse rounded-md" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border last:border-0">
            <div className="h-4 w-48 bg-muted animate-pulse rounded-md flex-1" />
            <div className="h-4 w-16 bg-muted animate-pulse rounded-md hidden sm:block" />
            <div className="h-4 w-28 bg-muted animate-pulse rounded-md hidden md:block" />
            <div className="h-4 w-32 bg-muted animate-pulse rounded-md hidden lg:block" />
            <div className="h-4 w-16 bg-muted animate-pulse rounded-md hidden lg:block" />
            <div className="h-5 w-20 bg-muted animate-pulse rounded-full hidden md:block" />
            <div className="h-4 w-16 bg-muted animate-pulse rounded-md" />
          </div>
        ))}
      </div>
    </div>
  )
}
