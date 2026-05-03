export default function BlogLoading() {
  return (
    <>
      <div className="djp-paper-deep djp-grain border-b border-border/70 pt-32 pb-16 px-4 sm:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="h-3 w-72 bg-muted animate-pulse rounded-sm" />
          <div className="mt-12 grid lg:grid-cols-12 gap-8 items-end">
            <div className="lg:col-span-8 space-y-4">
              <div className="h-3 w-32 bg-muted animate-pulse rounded-sm" />
              <div className="h-16 sm:h-20 lg:h-28 w-full max-w-[28rem] bg-muted animate-pulse rounded-sm" />
              <div className="h-16 sm:h-20 lg:h-28 w-full max-w-[24rem] bg-muted animate-pulse rounded-sm" />
            </div>
            <div className="lg:col-span-4 space-y-3">
              <div className="h-4 w-full bg-muted animate-pulse rounded-sm" />
              <div className="h-4 w-5/6 bg-muted animate-pulse rounded-sm" />
              <div className="h-4 w-3/4 bg-muted animate-pulse rounded-sm" />
            </div>
          </div>
        </div>
      </div>

      <div className="djp-paper px-4 sm:px-8 py-20">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-7 aspect-[5/4] bg-muted animate-pulse" />
          <div className="lg:col-span-5 space-y-4">
            <div className="h-3 w-40 bg-muted animate-pulse rounded-sm" />
            <div className="h-10 w-full bg-muted animate-pulse rounded-sm" />
            <div className="h-10 w-3/4 bg-muted animate-pulse rounded-sm" />
            <div className="h-3 w-full bg-muted animate-pulse rounded-sm" />
            <div className="h-3 w-5/6 bg-muted animate-pulse rounded-sm" />
          </div>
        </div>
      </div>
    </>
  )
}
