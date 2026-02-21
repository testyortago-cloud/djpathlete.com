export default function QuestionnaireLoading() {
  return (
    <div className="max-w-3xl mx-auto">
      {/* Heading */}
      <div className="mb-5 sm:mb-8">
        <div className="h-7 sm:h-8 w-56 bg-muted animate-pulse rounded-md" />
        <div className="h-4 sm:h-5 w-80 bg-muted animate-pulse rounded-md mt-1.5" />
      </div>

      {/* Form card */}
      <div className="bg-white rounded-xl border border-border p-4 sm:p-6 space-y-6">
        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-1.5 flex-1 bg-muted animate-pulse rounded-full"
            />
          ))}
        </div>

        {/* Section heading */}
        <div className="h-5 w-36 bg-muted animate-pulse rounded-md" />

        {/* Form fields */}
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-4 w-28 bg-muted animate-pulse rounded-md" />
            <div className="h-10 w-full bg-muted animate-pulse rounded-md" />
          </div>
        ))}

        {/* Textarea */}
        <div className="space-y-2">
          <div className="h-4 w-24 bg-muted animate-pulse rounded-md" />
          <div className="h-20 w-full bg-muted animate-pulse rounded-md" />
        </div>

        {/* Button */}
        <div className="h-10 w-24 bg-muted animate-pulse rounded-md" />
      </div>
    </div>
  )
}
