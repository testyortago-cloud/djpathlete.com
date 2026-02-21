export default function ProfileLoading() {
  return (
    <div>
      {/* Page heading */}
      <div className="h-7 sm:h-8 w-24 bg-muted animate-pulse rounded-md mb-5" />

      {/* Account Information card */}
      <div className="bg-white rounded-xl border border-border p-4 sm:p-6 mb-5">
        {/* Section heading */}
        <div className="h-3 sm:h-4 w-40 bg-muted animate-pulse rounded-md mb-3 sm:mb-4" />

        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <div className="space-y-1">
            <div className="h-2.5 sm:h-3 w-10 bg-muted animate-pulse rounded-md" />
            <div className="h-3 sm:h-4 w-28 bg-muted animate-pulse rounded-md" />
          </div>
          <div className="space-y-1">
            <div className="h-2.5 sm:h-3 w-10 bg-muted animate-pulse rounded-md" />
            <div className="h-3 sm:h-4 w-40 bg-muted animate-pulse rounded-md" />
          </div>
        </div>
      </div>

      {/* Profile form card */}
      <div className="bg-white rounded-xl border border-border p-4 sm:p-6 space-y-5">
        {/* Form heading */}
        <div className="h-5 w-32 bg-muted animate-pulse rounded-md" />

        {/* Form fields */}
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-4 w-24 bg-muted animate-pulse rounded-md" />
            <div className="h-10 w-full bg-muted animate-pulse rounded-md" />
          </div>
        ))}

        {/* Textarea field */}
        <div className="space-y-2">
          <div className="h-4 w-20 bg-muted animate-pulse rounded-md" />
          <div className="h-24 w-full bg-muted animate-pulse rounded-md" />
        </div>

        {/* Submit button */}
        <div className="h-10 w-32 bg-muted animate-pulse rounded-md" />
      </div>
    </div>
  )
}
