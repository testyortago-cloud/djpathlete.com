import { ErrorState } from "@/components/shared/ErrorState"

export default function RootNotFound() {
  return (
    <ErrorState
      variant="not-found"
      title="Page not found"
      description="The page you're looking for doesn't exist or has been moved. Head back to the home page to keep exploring."
      homeHref="/"
      homeLabel="Back to home"
    />
  )
}
