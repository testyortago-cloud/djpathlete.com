"use client"
import {
  DataTable,
  DataTableCard,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/ui/data-table"

import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Plus, Sparkles, Pencil, Trash2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { PromptTemplate } from "@/types/database"
import { PROMPT_TEMPLATE_CATEGORIES } from "@/lib/prompt-templates"
import { TemplateEditorModal } from "./template-editor-modal"
import { CreateFromIdeaModal } from "./create-from-idea-modal"

const CATEGORY_OPTIONS = ["all", ...Object.keys(PROMPT_TEMPLATE_CATEGORIES)]
const SCOPE_OPTIONS = ["all", "week", "day", "both"] as const

export function TemplatesTable() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  const [scopeFilter, setScopeFilter] = useState<string>("all")

  const [editorOpen, setEditorOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | null>(null)
  const [createFromIdeaOpen, setCreateFromIdeaOpen] = useState(false)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/ai-templates")
      if (!res.ok) throw new Error("Failed to load")
      const data = await res.json()
      setTemplates(data.templates as PromptTemplate[])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return templates.filter((t) => {
      if (categoryFilter !== "all" && t.category !== categoryFilter) return false
      if (scopeFilter !== "all" && t.scope !== scopeFilter) return false
      if (q && !t.name.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) return false
      return true
    })
  }, [templates, query, categoryFilter, scopeFilter])

  async function handleDelete(template: PromptTemplate) {
    if (!confirm(`Delete template "${template.name}"?`)) return
    try {
      const res = await fetch(`/api/admin/ai-templates/${template.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Delete failed")
      toast.success("Template deleted.")
      fetchAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed")
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search templates..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORY_OPTIONS.map((c) => (
              <SelectItem key={c} value={c}>
                {c === "all" ? "All categories" : (PROMPT_TEMPLATE_CATEGORIES[c] ?? c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={scopeFilter} onValueChange={setScopeFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCOPE_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "all" ? "All scopes" : s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" onClick={() => setCreateFromIdeaOpen(true)}>
          <Sparkles className="size-3.5 mr-1.5" />
          Create from idea
        </Button>

        <Button
          onClick={() => {
            setEditingTemplate(null)
            setEditorOpen(true)
          }}
        >
          <Plus className="size-3.5 mr-1.5" />
          New template
        </Button>
      </div>

      <DataTableCard>
        <DataTable>
          <DataTableHeader>
            <DataTableHead>Name</DataTableHead>
            <DataTableHead>Category</DataTableHead>
            <DataTableHead>Scope</DataTableHead>
            <DataTableHead>Updated</DataTableHead>
            <DataTableHead align="right" className="w-24">
              Actions
            </DataTableHead>
          </DataTableHeader>
          <tbody>
            {loading && (
              <DataTableRow>
                <DataTableCell muted colSpan={5} className="py-8 text-center">
                  Loading...
                </DataTableCell>
              </DataTableRow>
            )}
            {!loading && filtered.length === 0 && (
              <DataTableRow>
                <DataTableCell muted colSpan={5} className="py-8 text-center italic">
                  No templates. Click &quot;New template&quot; or &quot;Create from idea&quot; to add one.
                </DataTableCell>
              </DataTableRow>
            )}
            {!loading &&
              filtered.map((t) => (
                <DataTableRow
                  key={t.id}
                  onClick={() => {
                    setEditingTemplate(t)
                    setEditorOpen(true)
                  }}
                  className="cursor-pointer"
                >
                  <DataTableCell>
                    <p className="font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground truncate max-w-md">{t.description}</p>
                  </DataTableCell>
                  <DataTableCell>
                    <span className="inline-block px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs">
                      {PROMPT_TEMPLATE_CATEGORIES[t.category] ?? t.category}
                    </span>
                  </DataTableCell>
                  <DataTableCell>
                    <span className="inline-block px-2 py-0.5 rounded-full bg-accent/10 text-accent text-xs capitalize">
                      {t.scope}
                    </span>
                  </DataTableCell>
                  <DataTableCell muted className="text-xs">
                    {new Date(t.updated_at).toLocaleDateString()}
                  </DataTableCell>
                  <DataTableCell align="right">
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingTemplate(t)
                          setEditorOpen(true)
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(t)
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </DataTableCell>
                </DataTableRow>
              ))}
          </tbody>
        </DataTable>
      </DataTableCard>

      <TemplateEditorModal
        open={editorOpen}
        onOpenChange={setEditorOpen}
        template={editingTemplate}
        onSaved={() => {
          setEditorOpen(false)
          setEditingTemplate(null)
          fetchAll()
        }}
      />

      <CreateFromIdeaModal open={createFromIdeaOpen} onOpenChange={setCreateFromIdeaOpen} onSaved={fetchAll} />
    </div>
  )
}
