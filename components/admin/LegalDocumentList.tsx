"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  FileText,
  Shield,
  Lock,
  Plus,
  Pencil,
  CheckCircle2,
  Clock,
  Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LegalEditor } from "@/components/admin/LegalEditor"
import { toast } from "sonner"
import type { LegalDocument, LegalDocumentType } from "@/types/database"

const DOC_TYPE_CONFIG: Record<
  LegalDocumentType,
  { label: string; icon: typeof FileText; color: string }
> = {
  terms_of_service: {
    label: "Terms of Service",
    icon: FileText,
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  privacy_policy: {
    label: "Privacy Policy",
    icon: Lock,
    color: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  },
  liability_waiver: {
    label: "Liability Waiver",
    icon: Shield,
    color: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
}

interface LegalDocumentListProps {
  documents: LegalDocument[]
  consentCounts: Record<string, number>
}

export function LegalDocumentList({ documents, consentCounts }: LegalDocumentListProps) {
  const router = useRouter()
  const [newVersionOpen, setNewVersionOpen] = useState(false)
  const [newVersionType, setNewVersionType] = useState<LegalDocumentType | null>(null)
  const [newTitle, setNewTitle] = useState("")
  const [newEffectiveDate, setNewEffectiveDate] = useState(
    new Date().toISOString().split("T")[0]
  )
  const [newContent, setNewContent] = useState("")
  const [isCreating, setIsCreating] = useState(false)

  // Group documents by type
  const grouped = documents.reduce(
    (acc, doc) => {
      if (!acc[doc.document_type]) acc[doc.document_type] = []
      acc[doc.document_type].push(doc)
      return acc
    },
    {} as Record<string, LegalDocument[]>
  )

  const docTypes: LegalDocumentType[] = ["terms_of_service", "privacy_policy", "liability_waiver"]

  function handleNewVersion(type: LegalDocumentType) {
    const config = DOC_TYPE_CONFIG[type]
    const existing = grouped[type]?.[0]
    setNewVersionType(type)
    setNewTitle(existing?.title ?? config.label)
    setNewContent(existing?.content ?? "")
    setNewEffectiveDate(new Date().toISOString().split("T")[0])
    setNewVersionOpen(true)
  }

  async function handleCreateVersion() {
    if (!newVersionType) return
    setIsCreating(true)

    try {
      const res = await fetch("/api/admin/legal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_type: newVersionType,
          title: newTitle,
          content: newContent,
          effective_date: newEffectiveDate,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || "Failed to create new version")
        setIsCreating(false)
        return
      }

      toast.success("New version created successfully")
      setNewVersionOpen(false)
      router.refresh()
    } catch {
      toast.error("Failed to create new version")
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <>
      <div className="space-y-6">
        {docTypes.map((type) => {
          const config = DOC_TYPE_CONFIG[type]
          const docs = grouped[type] ?? []
          const active = docs.find((d) => d.is_active)
          const Icon = config.icon

          return (
            <div
              key={type}
              className="rounded-xl border border-border bg-card overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${config.color}`}>
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      {config.label}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {docs.length} version{docs.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleNewVersion(type)}
                  className="gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New Version
                </Button>
              </div>

              {/* Versions list */}
              <div className="divide-y divide-border">
                {docs.length === 0 ? (
                  <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                    No document created yet. Click &quot;New Version&quot; to get started.
                  </div>
                ) : (
                  docs.map((doc) => {
                    const consents = consentCounts[doc.id] ?? 0
                    return (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between px-5 py-3.5 hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {doc.is_active ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                          ) : (
                            <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-foreground">
                                v{doc.version}
                              </span>
                              {doc.is_active && (
                                <span className="inline-flex items-center rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                                  Active
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">
                              Effective{" "}
                              {new Date(doc.effective_date).toLocaleDateString("en-AU", {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              })}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Users className="h-3.5 w-3.5" />
                            <span>{consents}</span>
                          </div>
                          <Link href={`/admin/legal/${doc.id}`}>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </Link>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* New Version Dialog */}
      <Dialog open={newVersionOpen} onOpenChange={setNewVersionOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              Create New Version —{" "}
              {newVersionType ? DOC_TYPE_CONFIG[newVersionType].label : ""}
            </DialogTitle>
            <DialogDescription>
              This will create a new active version and deactivate the current one.
              Existing consent records are preserved.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 flex-1 overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="newTitle">Title</Label>
                <Input
                  id="newTitle"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  disabled={isCreating}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newEffectiveDate">Effective Date</Label>
                <Input
                  id="newEffectiveDate"
                  type="date"
                  value={newEffectiveDate}
                  onChange={(e) => setNewEffectiveDate(e.target.value)}
                  disabled={isCreating}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Content</Label>
              <LegalEditor
                content={newContent}
                onChange={setNewContent}
                disabled={isCreating}
                minHeight="350px"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setNewVersionOpen(false)}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateVersion}
              disabled={isCreating || !newTitle.trim() || !newContent.trim()}
            >
              {isCreating ? "Creating..." : "Create Version"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
