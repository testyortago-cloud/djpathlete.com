import { Star, Eye, BarChart3 } from "lucide-react"
import { getReviews } from "@/lib/db/reviews"
import { ReviewList } from "@/components/admin/ReviewList"

export const metadata = { title: "Reviews" }

export default async function ReviewsPage() {
  const reviews = await getReviews()

  const totalReviews = reviews.length
  const publishedCount = reviews.filter((r) => r.is_published).length
  const averageRating =
    totalReviews > 0
      ? (
          reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews
        ).toFixed(1)
      : "0.0"

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Reviews</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-10 rounded-lg bg-primary/10">
              <Star className="size-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Reviews</p>
              <p className="text-2xl font-semibold text-foreground">
                {totalReviews}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-10 rounded-lg bg-success/10">
              <Eye className="size-5 text-success" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Published</p>
              <p className="text-2xl font-semibold text-foreground">
                {publishedCount}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-10 rounded-lg bg-warning/10">
              <BarChart3 className="size-5 text-warning" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Average Rating</p>
              <p className="text-2xl font-semibold text-foreground">
                {averageRating}
                <span className="text-sm text-muted-foreground font-normal">
                  /5
                </span>
              </p>
            </div>
          </div>
        </div>
      </div>

      <ReviewList reviews={reviews} />
    </div>
  )
}
