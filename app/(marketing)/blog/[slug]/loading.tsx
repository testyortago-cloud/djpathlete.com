export default function BlogPostLoading() {
  return (
    <>
      <div className="djp-paper-deep border-b border-border/70 px-4 sm:px-8 pt-28 pb-4">
        <div className="max-w-6xl mx-auto h-3 w-full bg-muted animate-pulse rounded-sm max-w-md" />
      </div>

      <div className="djp-paper-deep djp-grain px-4 sm:px-8 pt-12 pb-20 border-b border-border/70">
        <div className="max-w-6xl mx-auto grid lg:grid-cols-12 gap-12">
          <div className="lg:col-span-9 space-y-4">
            <div className="h-3 w-40 bg-muted animate-pulse rounded-sm" />
            <div className="h-12 w-full bg-muted animate-pulse rounded-sm" />
            <div className="h-12 w-3/4 bg-muted animate-pulse rounded-sm" />
            <div className="h-4 w-full max-w-2xl bg-muted animate-pulse rounded-sm mt-6" />
            <div className="h-4 w-5/6 max-w-2xl bg-muted animate-pulse rounded-sm" />
          </div>
          <div className="lg:col-span-3 space-y-4">
            <div className="size-11 bg-muted animate-pulse rounded-full" />
            <div className="h-3 w-32 bg-muted animate-pulse rounded-sm" />
          </div>
        </div>
      </div>

      <div className="djp-paper px-4 sm:px-8 pt-12 pb-24">
        <div className="max-w-3xl mx-auto space-y-4">
          <div className="aspect-[16/9] bg-muted animate-pulse mb-10" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-3">
              {i % 3 === 0 && <div className="h-7 w-2/3 bg-muted animate-pulse rounded-sm mt-8" />}
              <div className="h-3 w-full bg-muted animate-pulse rounded-sm" />
              <div className="h-3 w-full bg-muted animate-pulse rounded-sm" />
              <div className="h-3 w-3/4 bg-muted animate-pulse rounded-sm" />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
