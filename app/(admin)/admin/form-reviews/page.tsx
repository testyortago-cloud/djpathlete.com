import { requireAdmin } from "@/lib/auth-helpers"
import { getAllFormReviews, getFormReviewCounts } from "@/lib/db/form-reviews"
import { FormReviewList } from "@/components/admin/FormReviewList"

export const metadata = { title: "Form Reviews | Admin | DJP Athlete" }

export default async function AdminFormReviewsPage() {
  await requireAdmin()

  let reviews: Awaited<ReturnType<typeof getAllFormReviews>> = []
  let counts = { pending: 0, in_progress: 0, reviewed: 0, total: 0 }

  try {
    ;[reviews, counts] = await Promise.all([getAllFormReviews(), getFormReviewCounts()])
  } catch {
    // Tables may not exist yet
  }

  return (
    <div>
      <h1 className="text-xl sm:text-2xl font-semibold text-primary mb-5">Form Reviews</h1>
      <FormReviewList reviews={reviews} counts={counts} />
    </div>
  )
}
