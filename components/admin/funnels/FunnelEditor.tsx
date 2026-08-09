"use client"

// GrapesJS mounted directly.
//
// @grapesjs/react is deliberately not used: it pins grapesjs ^0.22.5, which
// excludes the current 0.23.x, and the wrapper only saves the ~30 lines below.
//
// The canvas loads the app's own stylesheet, so a page STARTS on-brand even
// though a free-form builder can always leave the design system. That was the
// accepted trade-off when the free-form canvas was chosen over a typed block
// registry.

import { useCallback, useEffect, useRef, useState } from "react"
import grapesjs, { type Editor } from "grapesjs"
import { toast } from "sonner"
import { Eye, Save, Rocket } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ISLAND_NAMES, type IslandName } from "@/lib/funnels/islands"
import { ISLAND_TRAITS, islandBlockDefinitions } from "./island-traits"
import { buildIslandProps, readIslandProps } from "./island-props"
import "grapesjs/dist/css/grapes.min.css"

interface FunnelEditorProps {
  stepId: string
  publicUrl: string
  initialProjectData: unknown
}

export function FunnelEditor({ stepId, publicUrl, initialProjectData }: FunnelEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const [busy, setBusy] = useState<"idle" | "saving" | "publishing">("idle")

  useEffect(() => {
    if (!containerRef.current || editorRef.current) return

    const editor = grapesjs.init({
      container: containerRef.current,
      height: "100%",
      width: "auto",
      fromElement: false,
      // Saving is explicit (the buttons below), so GrapesJS must not also try.
      storageManager: false,
      // GrapesJS defaults this to a cdnjs Font Awesome URL. Our CSP is
      // `style-src 'self' 'unsafe-inline'` (next.config.mjs), so that request is
      // refused and every toolbar icon renders as an empty box. Empty string =
      // load no icon font; GrapesJS's own inline SVG icons still render.
      cssIcons: "",
      projectData: (initialProjectData as object | undefined) ?? undefined,
      canvas: {
        // Reuse the app's own compiled stylesheets inside the canvas iframe, so
        // the tokens and fonts on the canvas are the real ones rather than a
        // duplicate copy that can drift. In dev Next injects styles as <style>
        // tags rather than <link>, so this is empty and the canvas falls back to
        // browser defaults — production and `next build` output have the links.
        styles: appStylesheetHrefs(),
      },
      deviceManager: {
        devices: [
          { id: "desktop", name: "Desktop", width: "" },
          { id: "tablet", name: "Tablet", width: "768px", widthMedia: "992px" },
          { id: "mobile", name: "Mobile", width: "375px", widthMedia: "480px" },
        ],
      },
      blockManager: {
        blocks: [...layoutBlocks(), ...islandBlockDefinitions()],
      },
    })

    registerIslandTypes(editor)
    editorRef.current = editor

    return () => {
      editor.destroy()
      editorRef.current = null
    }
    // Mount once. Re-initialising on prop change would discard unsaved work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return
    setBusy("saving")
    try {
      const response = await fetch(`/api/admin/funnels/steps/${stepId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_data: editor.getProjectData() }),
      })
      if (!response.ok) {
        toast.error("Could not save the draft.")
        return
      }
      toast.success("Draft saved. The live page is unchanged.")
    } catch {
      toast.error("Could not save the draft.")
    } finally {
      setBusy("idle")
    }
  }, [stepId])

  const publish = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return
    setBusy("publishing")
    try {
      const response = await fetch(`/api/admin/funnels/steps/${stepId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          html: editor.getHtml(),
          css: editor.getCss() ?? "",
          project_data: editor.getProjectData(),
        }),
      })

      const body = (await response.json()) as {
        version?: number
        warnings?: string[]
        problems?: string[]
        error?: string
      }

      if (response.status === 422 && body.problems?.length) {
        // Publish refused rather than shipping a page with a broken element.
        toast.error(`Not published: ${body.problems[0]}`)
        return
      }
      if (!response.ok) {
        toast.error(body.error ?? "Could not publish.")
        return
      }

      for (const warning of body.warnings ?? []) toast.warning(warning)
      toast.success(`Published version ${body.version}.`)
    } catch {
      toast.error("Could not publish.")
    } finally {
      setBusy("idle")
    }
  }, [stepId])

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="flex items-center justify-end gap-2 border-b border-border bg-surface/50 p-3">
        <Button asChild variant="ghost" size="sm">
          <a href={`${publicUrl}?preview=1`} target="_blank" rel="noopener noreferrer">
            <Eye className="size-4" />
            Preview
          </a>
        </Button>
        <Button variant="outline" size="sm" onClick={save} disabled={busy !== "idle"}>
          <Save className="size-4" />
          {busy === "saving" ? "Saving…" : "Save draft"}
        </Button>
        <Button size="sm" onClick={publish} disabled={busy !== "idle"}>
          <Rocket className="size-4" />
          {busy === "publishing" ? "Publishing…" : "Publish"}
        </Button>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1" />
    </div>
  )
}

/** IslandTrait type -> GrapesJS trait input type. */
function traitInputType(type: string): string {
  if (type === "checkbox") return "checkbox"
  if (type === "number") return "number"
  if (type === "select") return "select"
  // `json` is edited as free text and parsed on sync.
  return "text"
}

/** Stylesheet URLs the admin app itself is currently using. */
function appStylesheetHrefs(): string[] {
  if (typeof document === "undefined") return []
  return Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
    .map((link) => link.href)
    .filter((href) => href.length > 0)
}

// ---------------------------------------------------------------------------
// Island component types
// ---------------------------------------------------------------------------

/**
 * Teaches GrapesJS about the six islands so they show typed settings instead of
 * being anonymous divs, and keeps `data-djp-props` in sync with those settings.
 */
function registerIslandTypes(editor: Editor) {
  for (const name of ISLAND_NAMES) {
    const traits = ISLAND_TRAITS[name]

    editor.DomComponents.addType(`djp-island-${name}`, {
      isComponent: (el: HTMLElement) =>
        el?.getAttribute?.("data-djp-island") === name ? { type: `djp-island-${name}` } : undefined,
      model: {
        defaults: {
          droppable: false,
          // The placeholder is a label, not content the owner edits inline.
          editable: false,
          traits: traits.map((trait) => ({
            name: trait.name,
            label: trait.label,
            // changeProp is THE critical flag. GrapesJS defaults it to false,
            // which binds a trait to the component's HTML *attributes*
            // (grapes.mjs: `value = this.changeProp ? component.get(name)
            // : attrs[name]`). Our init() seeds properties and syncProps()
            // reads properties, so with the default the two halves never meet:
            // every setting the owner typed was silently discarded and the
            // inputs rendered blank. Property-bound is the correct side here,
            // because data-djp-props — not the attribute — is what the
            // compiler reads.
            changeProp: true,
            type: traitInputType(trait.type),
            ...(trait.options ? { options: trait.options } : {}),
          })),
        },
        init() {
          // Seed traits from whatever props the placeholder already carries.
          const self = this as unknown as IslandModel
          const props = readProps(self, name)
          for (const trait of traits) {
            const value = props[trait.name]
            if (value === undefined) continue
            self.set(trait.name, trait.type === "json" ? JSON.stringify(value) : value, {
              silent: true,
            })
          }
          self.on("change", () => syncProps(self, name))
        },
      },
    })
  }
}

interface IslandModel {
  get(key: string): unknown
  set(key: string, value: unknown, opts?: { silent?: boolean }): void
  getAttributes(): Record<string, string>
  addAttributes(attrs: Record<string, string>): void
  on(event: string, handler: () => void): void
}

function readProps(model: IslandModel, name: IslandName): Record<string, unknown> {
  return readIslandProps(model.getAttributes()["data-djp-props"], name)
}

/** Trait values -> data-djp-props JSON, which is what the compiler reads. */
function syncProps(model: IslandModel, name: IslandName) {
  const props = buildIslandProps(readProps(model, name), name, (traitName) =>
    model.get(traitName),
  )
  model.addAttributes({ "data-djp-props": JSON.stringify(props) })
}

// ---------------------------------------------------------------------------
// Layout blocks
// ---------------------------------------------------------------------------

function layoutBlocks() {
  return [
    {
      id: "djp-section",
      label: "Section",
      category: "Layout",
      content: '<section style="padding:64px 24px"><div style="max-width:1100px;margin:0 auto"></div></section>',
    },
    {
      id: "djp-two-col",
      label: "Two columns",
      category: "Layout",
      content:
        '<div style="display:flex;gap:32px;flex-wrap:wrap"><div style="flex:1 1 280px"></div><div style="flex:1 1 280px"></div></div>',
    },
    {
      id: "djp-heading",
      label: "Heading",
      category: "Content",
      content: '<h1 style="font-size:clamp(2rem,5vw,3.5rem);line-height:1.1">Your headline</h1>',
    },
    {
      id: "djp-text",
      label: "Text",
      category: "Content",
      content: "<p>Write something persuasive here.</p>",
    },
    {
      id: "djp-image",
      label: "Image",
      category: "Content",
      content: { type: "image" },
      activate: true,
    },
    {
      id: "djp-button",
      label: "Link button",
      category: "Content",
      content:
        '<a href="#" style="display:inline-block;padding:14px 28px;border-radius:8px;background:#1f4d5a;color:#fff;text-decoration:none">Call to action</a>',
    },
    {
      id: "djp-video",
      label: "Video embed",
      category: "Content",
      content:
        '<iframe width="560" height="315" src="https://www.youtube.com/embed/" frameborder="0" allowfullscreen></iframe>',
    },
  ]
}
