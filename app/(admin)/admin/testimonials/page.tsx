import { Star, Eye, Heart } from "lucide-react"
import { getTestimonials } from "@/lib/db/testimonials"
import { TestimonialList } from "@/components/admin/TestimonialList"

export const metadata = { title: "Testimonials" }

export default async function TestimonialsPage() {
  const testimonials = await getTestimonials(false)

  const total = testimonials.length
  const activeCount = testimonials.filter((t) => t.is_active).length
  const featuredCount = testimonials.filter((t) => t.is_featured).length

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Testimonials</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-10 rounded-lg bg-primary/10">
              <Star className="size-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Testimonials</p>
              <p className="text-2xl font-semibold text-foreground">{total}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-10 rounded-lg bg-success/10">
              <Eye className="size-5 text-success" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Active</p>
              <p className="text-2xl font-semibold text-foreground">{activeCount}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-10 rounded-lg bg-warning/10">
              <Heart className="size-5 text-warning" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Featured</p>
              <p className="text-2xl font-semibold text-foreground">{featuredCount}</p>
            </div>
          </div>
        </div>
      </div>

      <TestimonialList testimonials={testimonials} />
    </div>
  )
}
