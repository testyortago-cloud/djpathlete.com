"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Sparkles, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EnhancePreviewModal, type EnhancePayload } from "./enhance-preview-modal"

interface Props {
  value: string
  scope: "week" | "day"
  onApply: (newText: string) => void
}

export function EnhanceTextareaButton({ value, scope, onApply }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<EnhancePayload | null>(null)

  async function runEnhance() {
    if (!value.trim()) return
    setLoading(true)
    setResult(null)
    setOpen(true)
    try {
      const res = await fetch("/api/admin/ai-templates/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "polish", input: value, target_scope: scope }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "Enhance failed")
      setResult(await res.json())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enhance failed")
      setOpen(false)
    } finally {
      setLoading(false)
    }
  }

  function handleApply(payload: EnhancePayload) {
    if (payload.mode === "polish") onApply(payload.prompt)
    setOpen(false)
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
        onClick={runEnhance}
        disabled={loading || !value.trim()}
      >
        {loading ? <Loader2 className="size-3 mr-1 animate-spin" /> : <Sparkles className="size-3 mr-1" />}
        Enhance
      </Button>

      <EnhancePreviewModal
        open={open}
        onOpenChange={setOpen}
        result={result}
        loading={loading}
        onRetry={runEnhance}
        onUse={handleApply}
      />
    </>
  )
}
