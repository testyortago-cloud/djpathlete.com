import { ErrorState } from "@/components/shared/ErrorState"

export default function MarketingNotFound() {
  return (
    <ErrorState
      variant="not-found"
      title="We couldn't find that page"
      description="The link may be broken, or the page may have moved. Try our services, programs, or head back to the homepage."
      homeHref="/"
      homeLabel="Back to home"
    />
  )
}
