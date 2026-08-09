"use client"

// next/dynamic with `ssr: false` is not allowed from a Server Component, and
// GrapesJS touches window/document at import time — so the dynamic import has
// to live behind this client boundary.

import dynamic from "next/dynamic"

const FunnelEditor = dynamic(
  () => import("./FunnelEditor").then((m) => m.FunnelEditor),
  {
    ssr: false,
    loading: () => <div className="p-8 text-sm text-muted-foreground">Loading editor…</div>,
  },
)

interface FunnelEditorLoaderProps {
  stepId: string
  publicUrl: string
  initialProjectData: unknown
}

export function FunnelEditorLoader(props: FunnelEditorLoaderProps) {
  return <FunnelEditor {...props} />
}
