"use client"

import { useState } from "react"
import Image from "next/image"
import { toast } from "sonner"
import { ExternalLink, Pencil, Trash2 } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { EditProductDialog } from "@/components/admin/shop/products/dialogs/EditProductDialog"
import { cn } from "@/lib/utils"
import type { ShopProduct } from "@/types/database"

interface ShopProductsTableProps {
  products: ShopProduct[]
}

export function ShopProductsTable({ products: initialProducts }: ShopProductsTableProps) {
  const [products, setProducts] = useState(initialProducts)
  const [editing, setEditing] = useState<ShopProduct | null>(null)
  const [deleting, setDeleting] = useState<ShopProduct | null>(null)
  const [deletingInFlight, setDeletingInFlight] = useState(false)

  async function handleDelete() {
    if (!deleting) return
    setDeletingInFlight(true)
    try {
      const res = await fetch(`/api/admin/shop/products/${deleting.id}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(
          typeof err.error === "string" ? err.error : `Delete failed (${res.status})`,
        )
      }
      setProducts((prev) => prev.filter((p) => p.id !== deleting.id))
      toast.success(`Deleted "${deleting.name}"`)
      setDeleting(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed")
    } finally {
      setDeletingInFlight(false)
    }
  }

  async function handleToggle(id: string, field: "is_active" | "is_featured", value: boolean) {
    // Optimistic update
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)))

    try {
      const res = await fetch(`/api/admin/shop/products/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? "Update failed")
      }
      toast.success(`Product ${field === "is_active" ? (value ? "activated" : "deactivated") : value ? "featured" : "unfeatured"}`)
    } catch (err) {
      // Revert on error
      setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: !value } : p)))
      toast.error((err as Error).message)
    }
  }

  if (products.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-8 text-center">
        <p className="text-muted-foreground text-sm">No products yet. Click &ldquo;Sync from Printful&rdquo; to import your catalog.</p>
      </div>
    )
  }

  return (
    <>
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Product
              </th>
              <th className="text-left px-3 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Type
              </th>
              <th className="text-center px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Active
              </th>
              <th className="text-center px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Featured
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Last Synced
              </th>
              <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {products.map((product) => {
              const thumbnailSrc = product.thumbnail_url_override ?? product.thumbnail_url
              const lastSynced = product.last_synced_at
                ? new Date(product.last_synced_at).toLocaleDateString()
                : "—"

              return (
                <tr key={product.id} className="hover:bg-muted/20 transition-colors">
                  {/* Thumbnail + name */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="shrink-0 size-12 rounded-lg overflow-hidden bg-muted border border-border">
                        {thumbnailSrc ? (
                          <Image
                            src={thumbnailSrc}
                            alt={product.name}
                            width={48}
                            height={48}
                            className="size-full object-cover"
                            unoptimized
                          />
                        ) : (
                          <div className="size-full flex items-center justify-center text-muted-foreground text-[10px]">
                            No img
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate max-w-[200px]">{product.name}</p>
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">/{product.slug}</p>
                      </div>
                    </div>
                  </td>

                  {/* Type badge */}
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest",
                        product.product_type === "pod" && "bg-primary/10 text-primary",
                        product.product_type === "digital" && "bg-accent/15 text-accent",
                        product.product_type === "affiliate" && "bg-muted text-muted-foreground",
                      )}
                    >
                      {product.product_type}
                    </span>
                  </td>

                  {/* Active toggle */}
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center">
                      <Switch
                        checked={product.is_active}
                        onCheckedChange={(checked) => handleToggle(product.id, "is_active", checked)}
                        aria-label={`Toggle active for ${product.name}`}
                      />
                    </div>
                  </td>

                  {/* Featured toggle */}
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center">
                      <Switch
                        checked={product.is_featured}
                        onCheckedChange={(checked) => handleToggle(product.id, "is_featured", checked)}
                        aria-label={`Toggle featured for ${product.name}`}
                      />
                    </div>
                  </td>

                  {/* Last synced */}
                  <td className="px-4 py-3 text-muted-foreground">{lastSynced}</td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setEditing(product)}
                        title="Edit product"
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon-xs" asChild>
                        <a
                          href={`/shop/${product.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="View public page"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      </Button>
                      {product.product_type !== "pod" && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => setDeleting(product)}
                          title="Delete product"
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
    <EditProductDialog
      product={editing}
      open={editing !== null}
      onOpenChange={(open) => {
        if (!open) setEditing(null)
      }}
    />
    <AlertDialog
      open={deleting !== null}
      onOpenChange={(open) => {
        if (!open && !deletingInFlight) setDeleting(null)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete product?</AlertDialogTitle>
          <AlertDialogDescription>
            {deleting
              ? `This will permanently delete "${deleting.name}" and its files${deleting.product_type === "affiliate" ? " and click history" : ""}. This cannot be undone.`
              : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deletingInFlight}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              handleDelete()
            }}
            disabled={deletingInFlight}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {deletingInFlight ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
