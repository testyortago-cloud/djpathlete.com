"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { FileText, Pencil, Trash2, Plus, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PROMPT_TEMPLATES, PROMPT_TEMPLATE_CATEGORIES, type PromptTemplate as BuiltInTemplate } from "@/lib/prompt-templates"
import type { PromptTemplate } from "@/types/database"
import { TemplateEditorModal } from "@/components/admin/ai-templates/template-editor-modal"

interface TemplateSelectorProps {
  onSelect: (prompt: string) => void
  scope: "week" | "day"
  /** Current textarea content — used for quick-save. If empty, the Save button is disabled. */
  currentText?: string
}

export function TemplateSelector({ onSelect, scope, currentText = "" }: TemplateSelectorProps) {
  const [open, setOpen] = useState(false)
  const ref_ = useRef<HTMLDivElement>(null)
  const [custom, setCustom] = useState<PromptTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | null>(null)
  const [seedForNew, setSeedForNew] = useState<{ prompt: string; scope: "week" | "day" } | null>(null)

  const fetchCustom = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/ai-templates?scope=${scope}`)
      if (!res.ok) throw new Error("Failed to load templates")
      const data = await res.json()
      setCustom(data.templates as PromptTemplate[])
    } catch {
      // silent — dropdown still works with built-ins
    } finally {
      setLoading(false)
    }
  }, [scope])

  useEffect(() => {
    if (open) fetchCustom()
  }, [open, fetchCustom])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref_.current && !ref_.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [open])

  function handleSelectBuiltIn(template: BuiltInTemplate) {
    onSelect(template.prompt)
    setOpen(false)
  }

  function handleSelectCustom(template: PromptTemplate) {
    onSelect(template.prompt)
    setOpen(false)
  }

  async function handleDelete(template: PromptTemplate, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Delete template "${template.name}"?`)) return
    try {
      const res = await fetch(`/api/admin/ai-templates/${template.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Delete failed")
      toast.success("Template deleted.")
      fetchCustom()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed")
    }
  }

  function handleEdit(template: PromptTemplate, e: React.MouseEvent) {
    e.stopPropagation()
    setEditingTemplate(template)
    setEditorOpen(true)
  }

  function handleQuickSave() {
    if (!currentText.trim()) {
      toast.error("Write something in the textarea first.")
      return
    }
    setSeedForNew({ prompt: currentText, scope })
    setEditingTemplate(null)
    setEditorOpen(true)
    setOpen(false)
  }

  const visibleBuiltIns = PROMPT_TEMPLATES.filter((t) => t.scope === scope || t.scope === "both")
  const groupedBuiltIns = Object.entries(PROMPT_TEMPLATE_CATEGORIES)
    .map(([key, label]) => ({
      key,
      label,
      templates: visibleBuiltIns.filter((t) => t.category === key),
    }))
    .filter((g) => g.templates.length > 0)

  return (
    <>
      <div className="relative" ref={ref_}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setOpen(!open)}
        >
          <FileText className="size-3 mr-1" />
          Templates
        </Button>

        {open && (
          <div className="absolute top-full right-0 mt-1 w-80 max-h-96 overflow-y-auto bg-white rounded-lg border border-border shadow-lg z-50 py-1">
            <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-surface/50">
              Built-in
            </p>
            {groupedBuiltIns.map((group) => (
              <div key={group.key}>
                <p className="px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                  {group.label}
                </p>
                {group.templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className="w-full text-left px-3 py-1.5 hover:bg-surface/50 transition-colors"
                    onClick={() => handleSelectBuiltIn(template)}
                  >
                    <p className="text-sm font-medium">{template.name}</p>
                    <p className="text-[11px] text-muted-foreground">{template.description}</p>
                  </button>
                ))}
              </div>
            ))}

            <p className="mt-1 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-surface/50">
              Custom
            </p>
            {loading && <p className="px-3 py-2 text-xs text-muted-foreground">Loading…</p>}
            {!loading && custom.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground italic">No custom templates yet.</p>
            )}
            {custom.map((template) => (
              <div
                key={template.id}
                className="group flex items-start w-full px-3 py-1.5 hover:bg-surface/50 transition-colors cursor-pointer"
                onClick={() => handleSelectCustom(template)}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{template.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{template.description}</p>
                </div>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                  <button
                    type="button"
                    className="p-1 text-muted-foreground hover:text-foreground"
                    onClick={(e) => handleEdit(template, e)}
                    title="Edit"
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    type="button"
                    className="p-1 text-muted-foreground hover:text-destructive"
                    onClick={(e) => handleDelete(template, e)}
                    title="Delete"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              </div>
            ))}

            <div className="border-t mt-1 pt-1">
              <button
                type="button"
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-surface/50 transition-colors"
                onClick={handleQuickSave}
              >
                <Plus className="size-3" />
                Save current as template
              </button>
              <Link
                href="/admin/ai-templates"
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-surface/50 transition-colors"
                onClick={() => setOpen(false)}
              >
                <Settings className="size-3" />
                Manage templates
              </Link>
            </div>
          </div>
        )}
      </div>

      <TemplateEditorModal
        open={editorOpen}
        onOpenChange={(o) => {
          setEditorOpen(o)
          if (!o) {
            setEditingTemplate(null)
            setSeedForNew(null)
          }
        }}
        template={editingTemplate}
        seed={seedForNew ? { prompt: seedForNew.prompt, scope: seedForNew.scope } : undefined}
        onSaved={() => {
          fetchCustom()
          setEditingTemplate(null)
          setSeedForNew(null)
        }}
      />
    </>
  )
}
