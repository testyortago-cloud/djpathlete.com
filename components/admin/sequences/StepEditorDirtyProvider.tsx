"use client"

// components/admin/sequences/StepEditorDirtyProvider.tsx — the one piece of
// client-side state that lets StepEditor and SequenceSwitch, two
// independently-mounted client components, agree on "is there something
// unsaved right now" — see StepEditorDirtyContext.tsx for why. Wraps the
// whole sequence detail screen's returned JSX in
// app/(admin)/admin/sequences/[key]/page.tsx; everything else in that JSX
// (server-rendered markup included) passes through as ordinary children.

import { useState, type ReactNode } from "react"
import { StepEditorDirtyContext } from "@/components/admin/sequences/StepEditorDirtyContext"

export function StepEditorDirtyProvider({ children }: { children: ReactNode }) {
  const [dirty, setDirty] = useState(false)
  return <StepEditorDirtyContext.Provider value={{ dirty, setDirty }}>{children}</StepEditorDirtyContext.Provider>
}
