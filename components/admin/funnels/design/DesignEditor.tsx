"use client"

// The visual builder.
//
// Craft owns the editing session; PageTree owns the document. Save walks Craft's
// node map through `craft-bridge` into a PageTree, and the SCHEMA decides
// whether that is a legal document — not the editor.
//
// The revision is carried in a ref rather than state so a save cannot read a
// stale closure of it: two saves in quick succession must send the revision the
// FIRST one came back with, or the second 409s against work it already owns.

import { useCallback, useRef, useState } from "react"
import Link from "next/link"
import { Editor, Frame, useEditor } from "@craftjs/core"
import { toast } from "sonner"
import { ArrowLeft, Redo2, Save, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { craftToTree, treeToCraft } from "@/lib/funnels/tree/craft-bridge"
import { pageTreeSchema } from "@/lib/funnels/tree/schema"
import type { PageTree } from "@/lib/funnels/tree/types"
import { CRAFT_RESOLVER } from "./craft-nodes"
import { Palette } from "./Palette"
import { Inspector } from "./Inspector"

interface DesignEditorProps {
  stepId: string
  stepName: string
  funnelId: string
  publicUrl: string
  initialTree: PageTree
  initialRevision: number
  /** The stored document did not parse. Editing must not silently overwrite it. */
  treeInvalid: boolean
}

export function DesignEditor(props: DesignEditorProps) {
  if (props.treeInvalid) {
    return (
      <div className="rounded-xl border border-[var(--error)]/40 bg-[var(--error)]/5 p-6">
        <h2 className="font-heading text-lg text-primary">This page&rsquo;s saved layout cannot be read</h2>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          Rather than opening a blank canvas — which your next save would write over the top of — the
          designer has stopped here. The published version of this page is unaffected and is still live.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link href={`/admin/funnels/${props.funnelId}`}>Back to the funnel</Link>
        </Button>
      </div>
    )
  }

  return (
    <Editor resolver={CRAFT_RESOLVER}>
      <EditorShell {...props} />
    </Editor>
  )
}

function EditorShell({
  stepId,
  stepName,
  funnelId,
  publicUrl,
  initialTree,
  initialRevision,
}: DesignEditorProps) {
  const { query, actions, canUndo, canRedo } = useEditor((state, q) => ({
    canUndo: q.history.canUndo(),
    canRedo: q.history.canRedo(),
  }))

  const revisionRef = useRef(initialRevision)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const save = useCallback(async () => {
    if (saving) return
    setSaving(true)
    try {
      const tree = craftToTree(query.getSerializedNodes() as never, initialTree.theme)

      // The schema is the gate, and it runs BEFORE the request: a document the
      // server would refuse should be reported here, where the owner still has
      // it on screen, rather than as a 400 after a round trip.
      const parsed = pageTreeSchema.safeParse(tree)
      if (!parsed.success) {
        toast.error("This layout could not be saved. Undo the last change and try again.")
        return
      }

      const response = await fetch(`/api/admin/funnels/steps/${stepId}/tree`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tree: parsed.data, revision: revisionRef.current }),
      })
      const body = (await response.json().catch(() => null)) as
        | { revision?: number; error?: string; code?: string }
        | null

      if (response.status === 409) {
        // Never retry blind. The other tab's work is real work.
        toast.error(body?.error ?? "This page changed in another tab. Reload before saving again.")
        return
      }
      if (!response.ok || typeof body?.revision !== "number") {
        toast.error(body?.error ?? "Could not save this page.")
        return
      }

      revisionRef.current = body.revision
      setDirty(false)
      toast.success("Saved.")
    } catch {
      toast.error("Could not save this page.")
    } finally {
      setSaving(false)
    }
  }, [initialTree.theme, query, saving, stepId])

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/admin/funnels/${funnelId}`}>
              <ArrowLeft className="size-4" />
              Back
            </Link>
          </Button>
          <div>
            <h1 className="font-heading text-lg text-primary">{stepName}</h1>
            <p className="text-xs text-muted-foreground">{publicUrl}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => actions.history.undo()}
            disabled={!canUndo}
            aria-label="Undo"
          >
            <Undo2 className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => actions.history.redo()}
            disabled={!canRedo}
            aria-label="Redo"
          >
            <Redo2 className="size-4" />
          </Button>
          <Button onClick={save} disabled={saving}>
            <Save className="size-4" />
            {saving ? "Saving…" : dirty ? "Save" : "Save"}
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden rounded-xl border border-border bg-white">
        <Palette />

        {/*
          The canvas is wrapped in #djp-funnel-root, the same id the published
          stylesheet is scoped to, so page styles stay confined exactly as they
          do in production. The residual risk runs the OTHER way — the admin
          app's base layer inheriting in — which is why the preview iframe
          remains the pre-publish check rather than this.
        */}
        <div className="flex-1 overflow-y-auto bg-surface/20 p-6" onInput={() => setDirty(true)}>
          <div id="djp-funnel-root" className="mx-auto max-w-4xl bg-white shadow-sm">
            <Frame data={JSON.stringify(treeToCraft(initialTree))} />
          </div>
        </div>

        <Inspector />
      </div>
    </div>
  )
}
