"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import type { Faq } from "@/types/database"
import type { FaqPage } from "@/lib/faq/pages"

interface Props {
  pages: FaqPage[]
}

type Status = "published" | "draft"

interface EditorState {
  id: string | null
  question: string
  answer: string
  category: string
  link_text: string
  link_href: string
  status: Status
}

const EMPTY_EDITOR: EditorState = {
  id: null,
  question: "",
  answer: "",
  category: "",
  link_text: "",
  link_href: "",
  status: "draft",
}

const GROUP_ORDER: FaqPage["group"][] = ["Static", "Sports", "Athletes", "Events"]

export function FaqManager({ pages }: Props) {
  const [pageKey, setPageKey] = useState<string>("")
  const [faqs, setFaqs] = useState<Faq[]>([])
  const [loading, setLoading] = useState(false)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [saving, setSaving] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const activePage = useMemo(
    () => pages.find((p) => p.key === pageKey) ?? null,
    [pages, pageKey],
  )

  const grouped = useMemo(() => {
    return GROUP_ORDER.map((group) => ({
      group,
      pages: pages.filter((p) => p.group === group),
    })).filter((g) => g.pages.length > 0)
  }, [pages])

  const loadFaqs = useCallback(async (key: string) => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/admin/marketing/faqs?page_key=${encodeURIComponent(key)}`,
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error ?? `HTTP ${res.status}`)
        setFaqs([])
        return
      }
      setFaqs((json.faqs as Faq[]) ?? [])
    } catch {
      toast.error("Failed to load FAQs")
      setFaqs([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (pageKey) {
      void loadFaqs(pageKey)
    } else {
      setFaqs([])
    }
    setEditor(null)
  }, [pageKey, loadFaqs])

  function openCreate() {
    setEditor({ ...EMPTY_EDITOR })
  }

  function openEdit(faq: Faq) {
    setEditor({
      id: faq.id,
      question: faq.question,
      answer: faq.answer,
      category: faq.category ?? "",
      link_text: faq.link_text ?? "",
      link_href: faq.link_href ?? "",
      status: faq.status as Status,
    })
  }

  async function submitEditor(e: React.FormEvent) {
    e.preventDefault()
    if (!editor || !activePage) return

    const linkText = editor.link_text.trim()
    const linkHref = editor.link_href.trim()
    if (Boolean(linkText) !== Boolean(linkHref)) {
      toast.error("Link text and link URL must both be set or both be empty")
      return
    }

    const body = {
      page_key: activePage.key,
      category: activePage.supportsCategories
        ? editor.category.trim() || null
        : null,
      question: editor.question.trim(),
      answer: editor.answer.trim(),
      link_text: linkText || null,
      link_href: linkHref || null,
      status: editor.status,
    }

    setSaving(true)
    try {
      const url = editor.id
        ? `/api/admin/marketing/faqs/${editor.id}`
        : "/api/admin/marketing/faqs"
      const method = editor.id ? "PATCH" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error ?? `HTTP ${res.status}`)
        return
      }
      toast.success(editor.id ? "FAQ saved" : "FAQ created")
      setEditor(null)
      await loadFaqs(activePage.key)
    } catch {
      toast.error("Failed to save FAQ")
    } finally {
      setSaving(false)
    }
  }

  async function deleteFaq(faq: Faq) {
    if (!activePage) return
    if (!confirm(`Delete this FAQ?\n\n"${faq.question}"\n\nThis cannot be undone.`)) {
      return
    }
    try {
      const res = await fetch(
        `/api/admin/marketing/faqs/${faq.id}?page_key=${encodeURIComponent(activePage.key)}`,
        { method: "DELETE" },
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error ?? `HTTP ${res.status}`)
        return
      }
      toast.success("FAQ deleted")
      await loadFaqs(activePage.key)
    } catch {
      toast.error("Failed to delete FAQ")
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id || !activePage) return

    const oldIndex = faqs.findIndex((f) => f.id === active.id)
    const newIndex = faqs.findIndex((f) => f.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return

    const prevFaqs = faqs
    const reordered = arrayMove(faqs, oldIndex, newIndex)
    setFaqs(reordered)

    try {
      const res = await fetch("/api/admin/marketing/faqs/reorder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          page_key: activePage.key,
          ordered_ids: reordered.map((f) => f.id),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error ?? `HTTP ${res.status}`)
        setFaqs(prevFaqs)
        return
      }
      toast.success("Order saved")
    } catch {
      toast.error("Failed to save order")
      setFaqs(prevFaqs)
    }
  }

  return (
    <div className="space-y-6">
      {/* Page picker */}
      <div className="border border-border rounded-xl bg-card p-4">
        <label className="block max-w-md">
          <span className="block text-sm font-medium text-primary mb-1">Page</span>
          <select
            value={pageKey}
            onChange={(e) => setPageKey(e.target.value)}
            className="faq-input"
          >
            <option value="">Select a page…</option>
            {grouped.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.pages.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {activePage && (
          <p className="text-xs text-muted-foreground mt-2">
            <span className="font-mono">{activePage.routePath}</span>
            {" · "}
            {activePage.contextSummary}
          </p>
        )}
      </div>

      {/* FAQ list */}
      {activePage && (
        <div className="border border-border rounded-xl bg-card overflow-hidden">
          <div className="p-4 border-b border-border/60 flex items-center gap-3">
            <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground flex-1">
              {loading ? "Loading…" : `${faqs.length} FAQ${faqs.length === 1 ? "" : "s"}`}
            </p>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
            >
              <Plus className="size-4" />
              Add FAQ
            </button>
          </div>

          {!loading && faqs.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm text-muted-foreground">
                No FAQs for this page yet. Click &quot;Add FAQ&quot; to create one.
              </p>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={faqs.map((f) => f.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="divide-y divide-border/60">
                  {faqs.map((faq) => (
                    <SortableFaqRow
                      key={faq.id}
                      faq={faq}
                      onEdit={() => openEdit(faq)}
                      onDelete={() => deleteFaq(faq)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}
        </div>
      )}

      {/* Editor dialog */}
      {editor && activePage && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
          onClick={() => !saving && setEditor(null)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={submitEditor}
            className="w-full max-w-2xl rounded-xl bg-card border border-border shadow-lg p-6 space-y-4"
          >
            <h2 className="text-lg font-heading text-primary">
              {editor.id ? "Edit FAQ" : "New FAQ"}
            </h2>

            <FaqField label="Question">
              <textarea
                value={editor.question}
                onChange={(e) =>
                  setEditor((s) => s && { ...s, question: e.target.value })
                }
                required
                maxLength={300}
                rows={2}
                className="faq-input"
              />
            </FaqField>

            <FaqField label="Answer">
              <textarea
                value={editor.answer}
                onChange={(e) =>
                  setEditor((s) => s && { ...s, answer: e.target.value })
                }
                required
                maxLength={2000}
                rows={5}
                className="faq-input"
              />
            </FaqField>

            {activePage.supportsCategories && (
              <FaqField
                label="Category"
                hint="Optional. Groups FAQs into sections on the page."
              >
                <input
                  type="text"
                  value={editor.category}
                  onChange={(e) =>
                    setEditor((s) => s && { ...s, category: e.target.value })
                  }
                  className="faq-input"
                />
              </FaqField>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FaqField
                label="Link text"
                hint="Optional internal link. Set both or neither."
              >
                <input
                  type="text"
                  value={editor.link_text}
                  onChange={(e) =>
                    setEditor((s) => s && { ...s, link_text: e.target.value })
                  }
                  className="faq-input"
                />
              </FaqField>
              <FaqField label="Link URL" hint="e.g. /assessment">
                <input
                  type="text"
                  value={editor.link_href}
                  onChange={(e) =>
                    setEditor((s) => s && { ...s, link_href: e.target.value })
                  }
                  className="faq-input"
                />
              </FaqField>
            </div>

            <FaqField label="Status">
              <select
                value={editor.status}
                onChange={(e) =>
                  setEditor(
                    (s) => s && { ...s, status: e.target.value as Status },
                  )
                }
                className="faq-input"
              >
                <option value="draft">draft</option>
                <option value="published">published</option>
              </select>
            </FaqField>

            <div className="flex items-center gap-3 pt-2 border-t border-border">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center px-4 py-2 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
              >
                {saving ? "Saving…" : editor.id ? "Save" : "Create"}
              </button>
              <button
                type="button"
                onClick={() => setEditor(null)}
                disabled={saving}
                className="text-sm text-muted-foreground hover:text-primary disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <style jsx>{`
        :global(.faq-input) {
          width: 100%;
          border: 1px solid var(--color-border, #e5e7eb);
          border-radius: 6px;
          padding: 8px 10px;
          background: white;
          color: inherit;
          font-size: 14px;
        }
        :global(.faq-input:focus) {
          outline: 2px solid var(--color-accent, #c49b7a);
          outline-offset: -1px;
        }
      `}</style>
    </div>
  )
}

function SortableFaqRow({
  faq,
  onEdit,
  onDelete,
}: {
  faq: Faq
  onEdit: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: faq.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`p-4 flex items-start gap-3 hover:bg-surface/40 bg-card ${
        isDragging ? "opacity-50 shadow-lg z-50" : ""
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder FAQ"
        className="shrink-0 mt-0.5 flex items-center cursor-grab active:cursor-grabbing touch-none text-muted-foreground hover:text-primary"
      >
        <GripVertical className="size-4" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-block text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${
              faq.status === "published"
                ? "bg-success/10 text-success"
                : "bg-warning/10 text-warning"
            }`}
          >
            {faq.status}
          </span>
          {faq.category && (
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              {faq.category}
            </span>
          )}
        </div>
        <p className="text-sm font-medium text-primary mt-1">{faq.question}</p>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
          {faq.answer}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onEdit}
          aria-label="Edit FAQ"
          className="p-2 rounded-md text-muted-foreground hover:text-primary hover:bg-surface"
        >
          <Pencil className="size-4" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete FAQ"
          className="p-2 rounded-md text-muted-foreground hover:text-error hover:bg-error/5"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    </li>
  )
}

function FaqField({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-primary mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground mt-1">{hint}</span>}
    </label>
  )
}
