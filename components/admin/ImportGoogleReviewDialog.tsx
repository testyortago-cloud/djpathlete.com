"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Star } from "lucide-react"
import { useFormTour } from "@/hooks/use-form-tour"
import { FormTour } from "@/components/admin/FormTour"
import { TourButton } from "@/components/admin/TourButton"
import { IMPORT_REVIEW_TOUR_STEPS } from "@/lib/tour-steps"

interface ImportGoogleReviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ImportGoogleReviewDialog({
  open,
  onOpenChange,
}: ImportGoogleReviewDialogProps) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const tour = useFormTour({ steps: IMPORT_REVIEW_TOUR_STEPS, scrollContainerRef: dialogRef })
  const [rating, setRating] = useState(5)
  const [bulkJson, setBulkJson] = useState("")

  async function handleSingleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsSubmitting(true)

    const formData = new FormData(e.currentTarget)
    const body = {
      reviewer_name: formData.get("reviewer_name") as string,
      rating,
      comment: (formData.get("comment") as string) || null,
      review_date: (formData.get("review_date") as string) || new Date().toISOString(),
    }

    try {
      const response = await fetch("/api/admin/google-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to import review")
      }

      toast.success("Google review added")
      onOpenChange(false)
      setRating(5)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to import review")
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleBulkSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsSubmitting(true)

    let reviews: unknown
    try {
      reviews = JSON.parse(bulkJson)
    } catch {
      toast.error("Invalid JSON — check your formatting")
      setIsSubmitting(false)
      return
    }

    if (!Array.isArray(reviews) || reviews.length === 0) {
      toast.error("JSON must be a non-empty array of reviews")
      setIsSubmitting(false)
      return
    }

    try {
      const response = await fetch("/api/admin/google-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reviews),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to import reviews")
      }

      const data = await response.json()
      toast.success(`${data.imported} Google review(s) imported`)
      onOpenChange(false)
      setBulkJson("")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to import reviews")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) tour.close(); onOpenChange(o) }}>
      <DialogContent ref={dialogRef} className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>Import Google Reviews</DialogTitle>
            <TourButton onClick={tour.start} />
          </div>
          <DialogDescription>
            Add Google Business Profile reviews manually. Use the single form or
            paste a JSON array for bulk import.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="single" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="single" className="flex-1">
              Single Review
            </TabsTrigger>
            <TabsTrigger value="bulk" className="flex-1">
              Bulk Import
            </TabsTrigger>
          </TabsList>

          {/* Single Review Tab */}
          <TabsContent value="single">
            <form onSubmit={handleSingleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reviewer_name">Reviewer Name *</Label>
                <Input
                  id="reviewer_name"
                  name="reviewer_name"
                  required
                  placeholder="John Doe"
                  disabled={isSubmitting}
                />
              </div>

              <div className="space-y-2">
                <Label>Rating *</Label>
                <div id="review-rating" className="flex gap-1">
                  {Array.from({ length: 5 }, (_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setRating(i + 1)}
                      className="p-0.5"
                    >
                      <Star
                        className={`size-6 transition-colors ${
                          i < rating
                            ? "fill-warning text-warning"
                            : "fill-none text-muted-foreground/40"
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="comment">Comment</Label>
                <Textarea
                  id="comment"
                  name="comment"
                  placeholder="Their review text..."
                  rows={3}
                  disabled={isSubmitting}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="review_date">Review Date</Label>
                <Input
                  id="review_date"
                  name="review_date"
                  type="date"
                  disabled={isSubmitting}
                />
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Adding..." : "Add Review"}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>

          {/* Bulk Import Tab */}
          <TabsContent value="bulk">
            <form onSubmit={handleBulkSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="bulk_json">JSON Array *</Label>
                <Textarea
                  id="bulk_json"
                  value={bulkJson}
                  onChange={(e) => setBulkJson(e.target.value)}
                  placeholder={`[
  {
    "reviewer_name": "John Doe",
    "rating": 5,
    "comment": "Great coaching!",
    "review_date": "2025-06-15"
  },
  {
    "reviewer_name": "Jane Smith",
    "rating": 4,
    "comment": "Really helped me improve.",
    "review_date": "2025-05-20"
  }
]`}
                  rows={10}
                  className="font-mono text-xs"
                  disabled={isSubmitting}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Each review needs: <code>reviewer_name</code>,{" "}
                  <code>rating</code> (1-5), <code>review_date</code>.{" "}
                  <code>comment</code> is optional.
                </p>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Importing..." : "Import Reviews"}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>
        </Tabs>
        <FormTour {...tour} />
      </DialogContent>
    </Dialog>
  )
}
