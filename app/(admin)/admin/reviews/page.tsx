import { Star } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"

export const metadata = { title: "Reviews" }

export default function ReviewsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Reviews</h1>
      <EmptyState
        icon={Star}
        heading="No reviews yet"
        description="Client reviews and testimonials will be managed here. Approve, feature, and respond to feedback from athletes."
      />
    </div>
  )
}
