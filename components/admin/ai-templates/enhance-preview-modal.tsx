"use client"

import { Loader2, Sparkles } from "lucide-react"
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

export type EnhanceMode = "polish" | "generate"

export interface PolishPayload {
  mode: "polish"
  prompt: string
}
export interface GeneratePayload {
  mode: "generate"
  name: string
  description: string
  category: string
  scope: string
  prompt: string
}
export type EnhancePayload = PolishPayload | GeneratePayload

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  result: EnhancePayload | null
  loading: boolean
  onRetry: () => void
  onUse: (payload: EnhancePayload) => void
}

export function EnhancePreviewModal({ open, onOpenChange, result, loading, onRetry, onUse }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-accent" />
            AI Enhancement Preview
          </DialogTitle>
          <DialogDescription>
            Review the AI&apos;s version before applying it.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="size-6 animate-spin text-accent" />
            <p className="text-sm text-muted-foreground">Enhancing...</p>
          </div>
        )}

        {!loading && result && (
          <div className="space-y-3">
            {result.mode === "generate" && (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Name</p>
                  <p className="font-medium">{result.name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Category</p>
                  <p className="font-medium capitalize">{result.category}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Description</p>
                  <p className="font-medium">{result.description}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Scope</p>
                  <p className="font-medium capitalize">{result.scope}</p>
                </div>
              </div>
            )}

            <div>
              <p className="text-xs text-muted-foreground mb-1">Prompt</p>
              <Textarea
                readOnly
                value={result.prompt}
                rows={10}
                className="font-mono text-xs field-sizing-fixed resize-none"
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Keep original
          </Button>
          <Button variant="outline" onClick={onRetry} disabled={loading}>
            Try again
          </Button>
          <Button onClick={() => result && onUse(result)} disabled={loading || !result}>
            Use this
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
