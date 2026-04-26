import { ErrorState } from "@/components/shared/ErrorState"

export default function AdminNotFound() {
  return (
    <div className="p-6">
      <ErrorState
        variant="not-found"
        title="That admin page doesn't exist"
        description="The link may be broken or the page may have moved. Use the sidebar, or jump back to the dashboard."
        homeHref="/admin"
        homeLabel="Back to dashboard"
        fullPage={false}
      />
    </div>
  )
}
