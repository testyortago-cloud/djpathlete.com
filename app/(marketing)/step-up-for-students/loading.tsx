export default function StepUpForStudentsLoading() {
  return (
    <div>
      {/* Hero */}
      <div className="bg-primary px-6 pt-24 pb-20">
        <div className="max-w-4xl mx-auto space-y-5">
          <div className="h-7 w-72 bg-white/10 animate-pulse rounded-full" />
          <div className="h-12 w-full max-w-2xl bg-white/10 animate-pulse rounded-md" />
          <div className="h-5 w-full max-w-xl bg-white/10 animate-pulse rounded-md" />
          <div className="h-11 w-48 bg-white/10 animate-pulse rounded-full mt-2" />
        </div>
      </div>

      <div className="max-w-5xl mx-auto py-16 px-6">
        <div className="h-8 w-64 bg-muted animate-pulse rounded-md mb-8" />
        <div className="grid sm:grid-cols-2 gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-44 bg-muted animate-pulse rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  )
}
