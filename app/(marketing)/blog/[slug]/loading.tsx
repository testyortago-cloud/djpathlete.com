export default function BlogPostLoading() {
  return (
    <div className="max-w-3xl mx-auto py-12 px-6">
      {/* Back link */}
      <div className="h-4 w-20 bg-muted animate-pulse rounded-md mb-8" />

      {/* Article header */}
      <div className="space-y-4 mb-8">
        <div className="h-5 w-20 bg-muted animate-pulse rounded-full" />
        <div className="h-9 w-full bg-muted animate-pulse rounded-md" />
        <div className="h-9 w-3/4 bg-muted animate-pulse rounded-md" />
        <div className="flex items-center gap-3">
          <div className="size-10 bg-muted animate-pulse rounded-full" />
          <div className="space-y-1">
            <div className="h-4 w-28 bg-muted animate-pulse rounded-md" />
            <div className="h-3 w-32 bg-muted animate-pulse rounded-md" />
          </div>
        </div>
      </div>

      {/* Featured image */}
      <div className="h-64 w-full bg-muted animate-pulse rounded-xl mb-8" />

      {/* Body paragraphs */}
      <div className="space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2">
            {i % 3 === 0 && <div className="h-6 w-48 bg-muted animate-pulse rounded-md mt-4" />}
            <div className="h-4 w-full bg-muted animate-pulse rounded-md" />
            <div className="h-4 w-full bg-muted animate-pulse rounded-md" />
            <div className="h-4 w-3/4 bg-muted animate-pulse rounded-md" />
          </div>
        ))}
      </div>
    </div>
  )
}
