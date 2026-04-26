import { ErrorState } from "@/components/shared/ErrorState"

export default function AuthNotFound() {
  return (
    <div className="py-12">
      <ErrorState
        variant="not-found"
        title="That sign-in page doesn't exist"
        description="The link may be outdated. Head to the login or registration page to continue."
        homeHref="/login"
        homeLabel="Go to login"
        fullPage={false}
      />
    </div>
  )
}
