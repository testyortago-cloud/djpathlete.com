"use client"

import { useState } from "react"
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  programFormSchema,
  PROGRAM_CATEGORIES,
  PROGRAM_DIFFICULTIES,
  type ProgramFormData,
} from "@/lib/validators/program"
import type { Program } from "@/types/database"

interface ProgramFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  program?: Program | null
}

const CATEGORY_LABELS: Record<string, string> = {
  strength: "Strength",
  conditioning: "Conditioning",
  sport_specific: "Sport Specific",
  recovery: "Recovery",
  nutrition: "Nutrition",
  hybrid: "Hybrid",
}

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  elite: "Elite",
}

export function ProgramFormDialog({
  open,
  onOpenChange,
  program,
}: ProgramFormDialogProps) {
  const router = useRouter()
  const isEditing = !!program
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<keyof ProgramFormData, string[]>>>({})

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})

    const formData = new FormData(e.currentTarget)
    const priceDollars = formData.get("price_dollars") as string
    const priceCents = priceDollars && priceDollars !== ""
      ? Math.round(parseFloat(priceDollars) * 100)
      : null

    const data = {
      name: formData.get("name") as string,
      description: formData.get("description") as string,
      category: formData.get("category") as string,
      difficulty: formData.get("difficulty") as string,
      duration_weeks: formData.get("duration_weeks") as string,
      sessions_per_week: formData.get("sessions_per_week") as string,
      price_cents: priceCents,
    }

    const result = programFormSchema.safeParse(data)
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors
      setErrors(fieldErrors)
      return
    }

    setIsSubmitting(true)

    try {
      const url = isEditing
        ? `/api/admin/programs/${program.id}`
        : "/api/admin/programs"
      const method = isEditing ? "PATCH" : "POST"

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.data),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Request failed")
      }

      toast.success(isEditing ? "Program updated successfully" : "Program created successfully")
      onOpenChange(false)
      router.refresh()
    } catch {
      toast.error(isEditing ? "Failed to update program" : "Failed to create program")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Program" : "Add Program"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the program details below."
              : "Fill in the details to create a new program."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              name="name"
              defaultValue={program?.name ?? ""}
              placeholder="e.g. 12-Week Strength Builder"
              required
              disabled={isSubmitting}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name[0]}</p>
            )}
          </div>

          {/* Category & Difficulty */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="category">Category *</Label>
              <select
                id="category"
                name="category"
                defaultValue={program?.category ?? ""}
                required
                disabled={isSubmitting}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="" disabled>Select category</option>
                {PROGRAM_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
                ))}
              </select>
              {errors.category && (
                <p className="text-xs text-destructive">{errors.category[0]}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="difficulty">Difficulty *</Label>
              <select
                id="difficulty"
                name="difficulty"
                defaultValue={program?.difficulty ?? ""}
                required
                disabled={isSubmitting}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="" disabled>Select difficulty</option>
                {PROGRAM_DIFFICULTIES.map((diff) => (
                  <option key={diff} value={diff}>{DIFFICULTY_LABELS[diff]}</option>
                ))}
              </select>
              {errors.difficulty && (
                <p className="text-xs text-destructive">{errors.difficulty[0]}</p>
              )}
            </div>
          </div>

          {/* Duration & Sessions */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="duration_weeks">Duration (weeks) *</Label>
              <Input
                id="duration_weeks"
                name="duration_weeks"
                type="number"
                min={1}
                defaultValue={program?.duration_weeks ?? ""}
                placeholder="e.g. 12"
                required
                disabled={isSubmitting}
              />
              {errors.duration_weeks && (
                <p className="text-xs text-destructive">{errors.duration_weeks[0]}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="sessions_per_week">Sessions/Week *</Label>
              <Input
                id="sessions_per_week"
                name="sessions_per_week"
                type="number"
                min={1}
                defaultValue={program?.sessions_per_week ?? ""}
                placeholder="e.g. 4"
                required
                disabled={isSubmitting}
              />
              {errors.sessions_per_week && (
                <p className="text-xs text-destructive">{errors.sessions_per_week[0]}</p>
              )}
            </div>
          </div>

          {/* Price */}
          <div className="space-y-2">
            <Label htmlFor="price_dollars">Price ($)</Label>
            <Input
              id="price_dollars"
              name="price_dollars"
              type="number"
              step="0.01"
              min={0}
              defaultValue={
                program?.price_cents != null
                  ? (program.price_cents / 100).toFixed(2)
                  : ""
              }
              placeholder="e.g. 99.99"
              disabled={isSubmitting}
            />
            {errors.price_cents && (
              <p className="text-xs text-destructive">{errors.price_cents[0]}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <textarea
              id="description"
              name="description"
              rows={3}
              defaultValue={program?.description ?? ""}
              placeholder="Brief description of the program..."
              disabled={isSubmitting}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            />
            {errors.description && (
              <p className="text-xs text-destructive">{errors.description[0]}</p>
            )}
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
              {isSubmitting
                ? isEditing ? "Saving..." : "Creating..."
                : isEditing ? "Save Changes" : "Create Program"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
