import { ErrorState } from "@/components/shared/ErrorState"

export default function ClientNotFound() {
  return (
    <div className="p-4 sm:p-6">
      <ErrorState
        variant="not-found"
        title="That page isn't part of your dashboard"
        description="The link may be broken or the page may have moved. Use the menu to find what you need, or head back to your dashboard."
        homeHref="/client/dashboard"
        homeLabel="Back to dashboard"
        fullPage={false}
      />
    </div>
  )
}
