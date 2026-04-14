import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { FormReviewUploadForm } from "@/components/client/FormReviewUploadForm"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"

export const metadata = { title: "New Form Review | DJP Athlete" }

export default async function NewFormReviewPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const userId = session.user.id

  return (
    <div>
      <Link
        href="/client/form-reviews"
        className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
      >
        <ArrowLeft className="size-3.5" />
        Back to Form Reviews
      </Link>

      <h1 className="text-xl sm:text-2xl font-semibold text-primary mb-5">Request Form Review</h1>

      <div className="bg-white rounded-xl border border-border p-4 sm:p-6">
        <FormReviewUploadForm userId={userId} />
      </div>
    </div>
  )
}
