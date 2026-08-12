"use client"

// Deliberately plainer than CreatePageDialog. A funnel is a container: the
// interesting questions belong to its steps, and asking them here would store a
// goal for something that does not have one.

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { slugify } from "@/lib/funnels/slug"
import { RESERVED_FUNNEL_SLUGS, FUNNEL_SLUG_PATTERN } from "@/lib/validators/funnel"

export function CreateFunnelDialog({ takenSlugs }: { takenSlugs: string[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)
  const [description, setDescription] = useState("")
  const [creating, setCreating] = useState(false)

  const effectiveSlug = slugTouched ? slug : slugify(name)

  const slugError = useMemo(() => {
    if (effectiveSlug === "") return null
    if (effectiveSlug.length < 2) return "Too short — use at least 2 characters."
    if (!FUNNEL_SLUG_PATTERN.test(effectiveSlug)) return "Lowercase letters, numbers and hyphens only."
    if (RESERVED_FUNNEL_SLUGS.has(effectiveSlug)) return "That address is reserved — pick another."
    if (takenSlugs.includes(effectiveSlug)) return "That address is already in use."
    return null
  }, [effectiveSlug, takenSlugs])

  const canSubmit = name.trim().length >= 2 && effectiveSlug.length >= 2 && slugError === null && !creating

  async function handleCreate() {
    if (!canSubmit) return
    setCreating(true)
    try {
      const response = await fetch("/api/admin/funnels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: effectiveSlug,
          kind: "funnel",
          description: description.trim() === "" ? null : description.trim(),
        }),
      })
      const body = (await response.json()) as { funnel?: { id: string }; error?: string }
      if (!response.ok || !body.funnel) {
        toast.error(body.error ?? "Could not create the funnel.")
        return
      }
      toast.success("Funnel created.")
      setOpen(false)
      // The step list, not the builder: the next decision is what the sequence
      // is, not what step one says.
      router.push(`/admin/funnels/${body.funnel.id}`)
    } catch {
      toast.error("Could not create the funnel.")
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          New funnel
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New funnel</DialogTitle>
          <DialogDescription>
            A sequence of steps sharing one address. You&rsquo;ll add and order the steps next.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="funnel-name">Name</Label>
            <Input
              id="funnel-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Summer Camp 2026"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="funnel-slug">URL</Label>
            <div className="flex items-center gap-1 rounded-md border border-border bg-surface/40 px-2">
              <span className="shrink-0 text-sm text-muted-foreground">/go/</span>
              <Input
                id="funnel-slug"
                value={effectiveSlug}
                onChange={(event) => {
                  setSlugTouched(true)
                  setSlug(slugify(event.target.value))
                }}
                placeholder="summer-camp-2026"
                className="border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
              />
            </div>
            {slugError ? (
              <p className="text-xs text-[var(--error)]">{slugError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Every step lives under <span className="font-mono">/go/{effectiveSlug || "…"}</span>
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="funnel-description">Describe it</Label>
            <Textarea
              id="funnel-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Registration flow for the summer camp: signup, payment, confirmation."
              rows={3}
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground">Optional. Only you see this.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={creating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!canSubmit}>
            {creating ? "Creating…" : "Create funnel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
