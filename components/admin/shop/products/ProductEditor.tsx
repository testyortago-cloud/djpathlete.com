"use client"

/**
 * TipTap decision: REUSED.
 * TipTap is installed (@tiptap/react ^3.20.0) and a fully featured editor
 * exists in components/admin/blog/BlogEditor.tsx. We reuse TipTap here via a
 * stripped-down inline editor (no image toolbar, just basic text formatting)
 * since product descriptions don't need blog-level image insertion.
 */

import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import { useCallback, useState } from "react"
import { toast } from "sonner"
import { Loader2, Save } from "lucide-react"
import { cn } from "@/lib/utils"
import { ImageUpload } from "./ImageUpload"
import type { ShopProduct } from "@/types/database"
import Image from "next/image"

interface ProductEditorProps {
  product: ShopProduct
}

export function ProductEditor({ product }: ProductEditorProps) {
  const [isActive, setIsActive] = useState(product.is_active)
  const [isFeatured, setIsFeatured] = useState(product.is_featured)
  const [thumbnailOverride, setThumbnailOverride] = useState<string | null>(
    product.thumbnail_url_override,
  )
  const [saving, setSaving] = useState(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, blockquote: false, codeBlock: false }),
      Placeholder.configure({ placeholder: "Add a product description…" }),
    ],
    immediatelyRender: false,
    content: product.description || "",
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none min-h-[120px] px-3 py-2.5 focus:outline-none text-sm",
      },
    },
  })

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        description: editor?.getHTML() ?? "",
        is_active: isActive,
        is_featured: isFeatured,
      }
      if (thumbnailOverride !== product.thumbnail_url_override) {
        body.thumbnail_url_override = thumbnailOverride
      }

      const res = await fetch(`/api/admin/shop/products/${product.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Save failed (${res.status})`)
      }

      toast.success("Product saved")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save product")
    } finally {
      setSaving(false)
    }
  }, [editor, isActive, isFeatured, thumbnailOverride, product])

  const thumbnailSrc = thumbnailOverride || product.thumbnail_url

  return (
    <div className="bg-white rounded-xl border border-border p-5 space-y-5">
      <h2 className="text-base font-heading text-primary">Product Details</h2>

      {/* Read-only fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Name">
          <p className="text-sm text-muted-foreground bg-surface px-3 py-2 rounded-lg border border-border">
            {product.name}
          </p>
        </Field>
        <Field label="Slug">
          <p className="text-sm text-muted-foreground font-mono bg-surface px-3 py-2 rounded-lg border border-border truncate">
            {product.slug}
          </p>
        </Field>
      </div>

      {/* Description (TipTap) */}
      <Field label="Description">
        <div className="rounded-lg border border-border overflow-hidden bg-white">
          <EditorContent editor={editor} />
        </div>
      </Field>

      {/* Thumbnail override */}
      <Field label="Thumbnail image">
        <div className="flex items-start gap-3">
          {thumbnailSrc && (
            <div className="relative size-16 rounded-lg overflow-hidden border border-border shrink-0 bg-surface">
              <Image
                src={thumbnailSrc}
                alt={product.name}
                fill
                className="object-cover"
                unoptimized
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <ImageUpload
              label="Upload override"
              onUploaded={(url) => setThumbnailOverride(url)}
            />
            {thumbnailOverride && (
              <button
                type="button"
                onClick={() => setThumbnailOverride(null)}
                className="text-xs text-muted-foreground hover:text-error transition-colors text-left"
              >
                Remove override
              </button>
            )}
            <p className="text-xs text-muted-foreground">
              {thumbnailOverride ? "Using custom image" : "Using Printful image"}
            </p>
          </div>
        </div>
      </Field>

      {/* Toggles */}
      <div className="flex flex-wrap gap-4">
        <Toggle
          id="is_active"
          label="Active (visible in shop)"
          checked={isActive}
          onChange={setIsActive}
        />
        <Toggle
          id="is_featured"
          label="Featured (shown first)"
          checked={isFeatured}
          onChange={setIsFeatured}
        />
      </div>

      {/* Save */}
      <div className="pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={cn(
            "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium",
            "bg-primary text-white hover:bg-primary/90 transition-colors",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </label>
      {children}
    </div>
  )
}

function Toggle({
  id,
  label,
  checked,
  onChange,
}: {
  id: string
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 cursor-pointer">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent",
          "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          checked ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block size-4 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </button>
      <span className="text-sm text-foreground">{label}</span>
    </label>
  )
}
