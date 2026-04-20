"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, Sparkles } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { PromptTemplate } from "@/types/database"
import { TEMPLATE_CATEGORIES, TEMPLATE_SCOPES } from "@/lib/validators/prompt-template"
import { PROMPT_TEMPLATE_CATEGORIES } from "@/lib/prompt-templates"
import { EnhancePreviewModal, type EnhancePayload } from "./enhance-preview-modal"

type Category = (typeof TEMPLATE_CATEGORIES)[number]
type Scope = (typeof TEMPLATE_SCOPES)[number]

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When present = edit mode. When null = create mode. */
  template: PromptTemplate | null
  /** Optional seed values for create mode (used by the quick-save-from-dialog flow). */
  seed?: Partial<Pick<PromptTemplate, "name" | "description" | "category" | "scope" | "prompt">>
  onSaved: () => void
}

export function TemplateEditorModal({ open, onOpenChange, template, seed, onSaved }: Props) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [category, setCategory] = useState<Category>("structure")
  const [scope, setScope] = useState<Scope>("both")
  const [prompt, setPrompt] = useState("")
  const [saving, setSaving] = useState(false)

  const [enhanceOpen, setEnhanceOpen] = useState(false)
  const [enhanceLoading, setEnhanceLoading] = useState(false)
  const [enhanceResult, setEnhanceResult] = useState<EnhancePayload | null>(null)

  useEffect(() => {
    if (!open) return
    if (template) {
      setName(template.name)
      setDescription(template.description)
      setCategory(template.category)
      setScope(template.scope)
      setPrompt(template.prompt)
    } else {
      setName(seed?.name ?? "")
      setDescription(seed?.description ?? "")
      setCategory((seed?.category as Category) ?? "structure")
      setScope((seed?.scope as Scope) ?? "both")
      setPrompt(seed?.prompt ?? "")
    }
  }, [open, template, seed])

  async function handleEnhance() {
    if (!prompt.trim()) {
      toast.error("Write something first, then Enhance will polish it.")
      return
    }
    setEnhanceLoading(true)
    setEnhanceResult(null)
    setEnhanceOpen(true)
    try {
      const res = await fetch("/api/admin/ai-templates/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "polish", input: prompt, target_scope: scope === "both" ? undefined : scope }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "Enhance failed")
      setEnhanceResult(await res.json())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enhance failed")
      setEnhanceOpen(false)
    } finally {
      setEnhanceLoading(false)
    }
  }

  function handleApplyEnhance(payload: EnhancePayload) {
    if (payload.mode === "polish") {
      setPrompt(payload.prompt)
    }
    setEnhanceOpen(false)
  }

  async function handleSave() {
    if (!name.trim() || !description.trim() || !prompt.trim()) {
      toast.error("Name, description, and prompt are required.")
      return
    }
    setSaving(true)
    try {
      const payload = { name, description, category, scope, prompt }
      const url = template ? `/api/admin/ai-templates/${template.id}` : "/api/admin/ai-templates"
      const method = template ? "PATCH" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed")
      toast.success(template ? "Template updated." : "Template created.")
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{template ? "Edit template" : "New template"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">Name</Label>
              <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-desc">Description</Label>
              <Input
                id="tpl-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={200}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {PROMPT_TEMPLATE_CATEGORIES[c] ?? c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Scope</Label>
                <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="week">Week only</SelectItem>
                    <SelectItem value="day">Day only</SelectItem>
                    <SelectItem value="both">Both</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="tpl-prompt">Prompt</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleEnhance}
                  disabled={enhanceLoading || !prompt.trim()}
                  className="h-6 px-2 text-xs"
                >
                  <Sparkles className="size-3 mr-1" />
                  Enhance
                </Button>
              </div>
              <Textarea
                id="tpl-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={8}
                maxLength={4000}
                className="font-mono text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
              {template ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EnhancePreviewModal
        open={enhanceOpen}
        onOpenChange={setEnhanceOpen}
        result={enhanceResult}
        loading={enhanceLoading}
        onRetry={handleEnhance}
        onUse={handleApplyEnhance}
      />
    </>
  )
}
