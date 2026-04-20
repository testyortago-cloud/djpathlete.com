"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Sparkles, Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { EnhancePreviewModal, type EnhancePayload, type GeneratePayload } from "./enhance-preview-modal"
import { TemplateEditorModal } from "./template-editor-modal"
import type { PromptTemplate } from "@/types/database"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

export function CreateFromIdeaModal({ open, onOpenChange, onSaved }: Props) {
  const [seed, setSeed] = useState("")
  const [loading, setLoading] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [result, setResult] = useState<EnhancePayload | null>(null)
  const [editorSeed, setEditorSeed] = useState<Partial<PromptTemplate> | null>(null)

  async function handleGenerate() {
    if (!seed.trim()) {
      toast.error("Describe your template idea first.")
      return
    }
    setLoading(true)
    setResult(null)
    setPreviewOpen(true)
    try {
      const res = await fetch("/api/admin/ai-templates/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "generate", input: seed }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "Generation failed")
      setResult(await res.json())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed")
      setPreviewOpen(false)
    } finally {
      setLoading(false)
    }
  }

  function handleUse(payload: EnhancePayload) {
    if (payload.mode !== "generate") return
    const g = payload as GeneratePayload
    setEditorSeed({
      name: g.name,
      description: g.description,
      category: g.category as PromptTemplate["category"],
      scope: g.scope as PromptTemplate["scope"],
      prompt: g.prompt,
    })
    setPreviewOpen(false)
    onOpenChange(false)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-accent" />
              Create template from idea
            </DialogTitle>
            <DialogDescription>
              Describe the template you want. AI will draft a full template you can review and save.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="idea-seed">Your idea</Label>
            <Textarea
              id="idea-seed"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="e.g., A back day focused on lat width — wide grip work, pullovers, mid-back accessories."
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={handleGenerate} disabled={loading}>
              {loading ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <Sparkles className="size-3.5 mr-1" />}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EnhancePreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        result={result}
        loading={loading}
        onRetry={handleGenerate}
        onUse={handleUse}
      />

      <TemplateEditorModal
        open={!!editorSeed}
        onOpenChange={(o) => !o && setEditorSeed(null)}
        template={null}
        seed={editorSeed ?? undefined}
        onSaved={() => {
          setEditorSeed(null)
          onSaved()
        }}
      />
    </>
  )
}
