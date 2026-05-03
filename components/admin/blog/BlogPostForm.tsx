"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Save, Send, Loader2, Sparkles, Search } from "lucide-react"
import { toast } from "sonner"
import { blogPostFormSchema, BLOG_CATEGORIES, type FaqEntry } from "@/lib/validators/blog-post"
import { BlogEditor } from "./BlogEditor"
import type { FactCheckStatus } from "./FactCheckBanner"
import type { FactCheckDetails } from "./FactCheckSidebar"
import type { SeoMetadata } from "@/types/database"
import { CoverImageUpload } from "./CoverImageUpload"
import { BlogGenerateDialog } from "./BlogGenerateDialog"
import { ResearchPanel, type TavilyResearchBrief } from "./ResearchPanel"
import { cn } from "@/lib/utils"
import type { BlogPost } from "@/types/database"
import { FormErrorBanner } from "@/components/shared/FormErrorBanner"
import { humanizeFieldError, summarizeApiError, type FieldErrors } from "@/lib/errors/humanize"

const BLOG_FIELD_LABELS: Record<string, string> = {
  title: "Title",
  slug: "Slug",
  excerpt: "Excerpt",
  content: "Content",
  category: "Category",
  cover_image_url: "Cover image",
  tags: "Tags",
  meta_description: "Meta description",
}

interface BlogPostFormProps {
  post?: BlogPost
  authorId: string
  /** Pre-fills the Generate dialog and opens it automatically (e.g. from topic suggestions). */
  initialPrompt?: string
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function BlogPostForm({ post, authorId, initialPrompt }: BlogPostFormProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(Boolean(initialPrompt))
  const [editorKey, setEditorKey] = useState(0)
  const [researchOpen, setResearchOpen] = useState(false)
  const [researchBrief, setResearchBrief] = useState<TavilyResearchBrief | null>(
    (post?.tavily_research as TavilyResearchBrief | null) ?? null,
  )
  const hasBrief = researchBrief !== null

  const [title, setTitle] = useState(post?.title ?? "")
  const [slug, setSlug] = useState(post?.slug ?? "")
  const [excerpt, setExcerpt] = useState(post?.excerpt ?? "")
  const [content, setContent] = useState(post?.content ?? "")
  const [category, setCategory] = useState(post?.category ?? "")
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(post?.cover_image_url ?? null)
  const [tags, setTags] = useState(post?.tags?.join(", ") ?? "")
  const [metaDescription, setMetaDescription] = useState(post?.meta_description ?? "")
  const [subcategory, setSubcategory] = useState(post?.subcategory ?? "")
  const [faqEntries, setFaqEntries] = useState<FaqEntry[]>(post?.faq ?? [])
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  // Auto-slug from title unless manually edited
  useEffect(() => {
    if (!slugManuallyEdited && !post) {
      setSlug(slugify(title))
    }
  }, [title, slugManuallyEdited, post])

  const buildPayload = useCallback(() => {
    const tagsArray = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)

    return {
      title,
      slug,
      excerpt,
      content,
      category,
      cover_image_url: coverImageUrl,
      tags: tagsArray,
      meta_description: metaDescription || null,
      subcategory: subcategory.trim() || null,
      faq: faqEntries,
    }
  }, [title, slug, excerpt, content, category, coverImageUrl, tags, metaDescription, subcategory, faqEntries])

  function addFaqEntry() {
    if (faqEntries.length >= 5) return
    setFaqEntries((prev) => [...prev, { question: "", answer: "" }])
  }

  function removeFaqEntry(idx: number) {
    setFaqEntries((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateFaqEntry(idx: number, field: keyof FaqEntry, value: string) {
    setFaqEntries((prev) => prev.map((entry, i) => (i === idx ? { ...entry, [field]: value } : entry)))
  }

  async function handleSave(publish: boolean) {
    setFormError(null)
    setFieldErrors({})
    const payload = buildPayload()

    const parsed = blogPostFormSchema.safeParse(payload)
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors
      setFieldErrors(flat as FieldErrors)
      setFormError("Please fix the highlighted fields before saving.")
      const firstEntry = Object.entries(flat).find(([, v]) => v && v.length > 0)
      if (firstEntry) {
        toast.error(humanizeFieldError(firstEntry[0], firstEntry[1]?.[0], BLOG_FIELD_LABELS))
      }
      return
    }

    const isPublishing = publish && (!post || post.status === "draft")

    if (isPublishing) {
      setPublishing(true)
    } else {
      setSaving(true)
    }

    try {
      if (post) {
        // Update existing post
        const res = await fetch(`/api/admin/blog/${post.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          const { message, fieldErrors: fe } = summarizeApiError(res, data, "Failed to save post")
          setFormError(message)
          setFieldErrors(fe)
          throw new Error(message)
        }

        // Publish if requested
        if (isPublishing) {
          const pubRes = await fetch(`/api/admin/blog/${post.id}/publish`, {
            method: "POST",
          })
          if (!pubRes.ok) {
            const data = await pubRes.json().catch(() => ({}))
            const { message } = summarizeApiError(pubRes, data, "Failed to publish post")
            setFormError(message)
            throw new Error(message)
          }
          toast.success("Post published!")
        } else {
          toast.success("Post saved!")
        }
      } else {
        // Create new post
        const res = await fetch("/api/admin/blog", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...parsed.data,
            author_id: authorId,
            status: publish ? "published" : "draft",
          }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          const { message, fieldErrors: fe } = summarizeApiError(res, data, "Failed to create post")
          setFormError(message)
          setFieldErrors(fe)
          throw new Error(message)
        }

        const created = await res.json()

        // If publishing a new post, also trigger the publish endpoint
        if (publish) {
          await fetch(`/api/admin/blog/${created.id}/publish`, {
            method: "POST",
          }).catch(() => {})
          toast.success("Post published!")
        } else {
          toast.success("Draft saved!")
        }
      }

      router.push("/admin/blog")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setSaving(false)
      setPublishing(false)
    }
  }

  function handleAiGenerated(data: {
    title: string
    slug: string
    excerpt: string
    content: string
    category: string
    tags: string[]
    meta_description: string
  }) {
    setTitle(data.title)
    setSlug(data.slug)
    setSlugManuallyEdited(true)
    setExcerpt(data.excerpt)
    setContent(data.content)
    setCategory(data.category)
    setTags(data.tags.join(", "))
    setMetaDescription(data.meta_description)
    setEditorKey((k) => k + 1)
    setGenerateOpen(false)
  }

  const hasExistingContent = !!(title || content || excerpt)
  const busy = saving || publishing

  return (
    <div>
      {/* Top bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <Link
          href="/admin/blog"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
        >
          <ArrowLeft className="size-4" />
          Back to Blog
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setGenerateOpen(true)}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-primary/30 text-sm font-medium text-primary hover:bg-primary/5 transition-colors disabled:opacity-50"
          >
            <Sparkles className="size-4" />
            Generate with AI
          </button>
          <button
            type="button"
            onClick={() => setResearchOpen((o) => !o)}
            disabled={!post?.id || !title.trim()}
            className={cn(
              "inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md",
              "bg-surface text-primary border border-border hover:bg-surface/80",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              researchOpen && "bg-primary/5 border-primary/30",
            )}
            title={
              !post?.id
                ? "Save the post once before researching"
                : !title.trim()
                  ? "Add a title first"
                  : "Open research panel"
            }
          >
            <Search className="size-4" />
            Research
            {hasBrief && <span className="ml-1 size-1.5 rounded-full bg-accent" aria-label="Has research brief" />}
          </button>
          <button
            type="button"
            onClick={() => handleSave(false)}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-surface transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save Draft
          </button>
          <button
            type="button"
            onClick={() => handleSave(true)}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {publishing ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {post?.status === "published" ? "Update" : "Publish"}
          </button>
        </div>
      </div>

      {(formError || Object.keys(fieldErrors).length > 0) && (
        <div className="mb-4">
          <FormErrorBanner message={formError} fieldErrors={fieldErrors} labels={BLOG_FIELD_LABELS} />
        </div>
      )}

      {/* Two column layout */}
      <div className="flex flex-col lg:flex-row">
        <div className="flex-1 min-w-0">
          <div className="grid lg:grid-cols-[1fr_320px] gap-6">
            {/* Left column — main content */}
            <div className="space-y-4">
              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Post title"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>

              {/* Slug */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Slug</label>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value)
                    setSlugManuallyEdited(true)
                  }}
                  placeholder="post-slug"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
                <p className="text-xs text-muted-foreground mt-1">/blog/{slug || "..."}</p>
              </div>

              {/* Editor */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Content</label>
                <BlogEditor
                  key={editorKey}
                  content={content}
                  onChange={setContent}
                  factCheckStatus={(post?.fact_check_status as FactCheckStatus | null) ?? null}
                  factCheckDetails={(post?.fact_check_details as FactCheckDetails | null) ?? null}
                  seoMetadata={(post?.seo_metadata as SeoMetadata | null) ?? null}
                />
              </div>

              {/* Excerpt */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Excerpt</label>
                <textarea
                  value={excerpt}
                  onChange={(e) => setExcerpt(e.target.value)}
                  placeholder="Brief summary of the post (10-500 characters)"
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
                <p className="text-xs text-muted-foreground mt-1">{excerpt.length}/500</p>
              </div>
            </div>

            {/* Right column — sidebar */}
            <div className="space-y-4">
              {/* Cover Image */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Cover Image</label>
                <CoverImageUpload currentUrl={coverImageUrl} postId={post?.id} onUploaded={setCoverImageUrl} />
              </div>

              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                >
                  <option value="">Select category</option>
                  {BLOG_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Tags */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Tags</label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="strength, recovery, youth"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
                <p className="text-xs text-muted-foreground mt-1">Comma-separated</p>
              </div>

              {/* Meta Description */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Meta Description</label>
                <textarea
                  value={metaDescription}
                  onChange={(e) => setMetaDescription(e.target.value)}
                  placeholder="SEO description (max 160 characters)"
                  rows={3}
                  maxLength={160}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
                <p className="text-xs text-muted-foreground mt-1">{metaDescription.length}/160</p>
              </div>

              {/* Subcategory */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Subcategory <span className="text-muted-foreground text-xs">(optional)</span>
                </label>
                <input
                  type="text"
                  value={subcategory}
                  onChange={(e) => setSubcategory(e.target.value)}
                  placeholder="e.g., Nutrition, Mindset, Injury Prevention"
                  className="w-full px-3 py-2 rounded-md border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  maxLength={80}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Free-text topical sub-classification. Complements the 4-value Category.
                </p>
              </div>

              {/* FAQ Editor */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-foreground">
                    FAQ <span className="text-muted-foreground text-xs">(3–5 entries recommended)</span>
                  </label>
                  <button
                    type="button"
                    onClick={addFaqEntry}
                    disabled={faqEntries.length >= 5}
                    className="text-xs font-medium px-2 py-1 rounded-md border border-border hover:bg-surface disabled:opacity-40"
                  >
                    + Add entry
                  </button>
                </div>
                {faqEntries.map((entry, idx) => (
                  <div key={idx} className="rounded-lg border border-border bg-white p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <input
                        type="text"
                        value={entry.question}
                        onChange={(e) => updateFaqEntry(idx, "question", e.target.value)}
                        placeholder="Question"
                        className="flex-1 px-2.5 py-1.5 rounded-md border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                        maxLength={200}
                      />
                      <button
                        type="button"
                        onClick={() => removeFaqEntry(idx)}
                        aria-label={`Remove FAQ ${idx + 1}`}
                        className="text-muted-foreground hover:text-red-500 px-2 py-1.5"
                      >
                        ×
                      </button>
                    </div>
                    <textarea
                      value={entry.answer}
                      onChange={(e) => updateFaqEntry(idx, "answer", e.target.value)}
                      placeholder="Answer (1-3 sentences)"
                      rows={3}
                      maxLength={800}
                      className="w-full px-2.5 py-1.5 rounded-md border border-border bg-white text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                ))}
                {faqEntries.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">
                    No FAQ entries yet — click &quot;+ Add entry&quot; to start.
                  </p>
                )}
              </div>

              {/* Status info */}
              {post && (
                <div className="rounded-lg border border-border bg-surface/50 p-3 text-xs text-muted-foreground space-y-1">
                  <p>
                    Status:{" "}
                    <span className="font-medium text-foreground">
                      {post.status === "published" ? "Published" : "Draft"}
                    </span>
                  </p>
                  {post.published_at && (
                    <p>
                      Published:{" "}
                      {new Date(post.published_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  )}
                  <p>
                    Created:{" "}
                    {new Date(post.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
        {researchOpen && post?.id && (
          <ResearchPanel
            blogPostId={post.id}
            postTitle={title}
            initialBrief={researchBrief}
            onBriefChange={setResearchBrief}
            onClose={() => setResearchOpen(false)}
          />
        )}
      </div>

      <BlogGenerateDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        onGenerated={handleAiGenerated}
        hasExistingContent={hasExistingContent}
        initialPrompt={initialPrompt}
      />
    </div>
  )
}
