"use client"

// components/admin/sequences/StepEditorDirtyContext.tsx — bridges "does the
// step editor have unsaved changes" from StepEditor to SequenceSwitch, which
// are independently-mounted client components on the sequence detail screen
// (app/(admin)/admin/sequences/[key]/page.tsx renders them in two different
// parts of one server-rendered page, not as parent/child of each other).
//
// WHY THIS EXISTS (whole-branch review, Important 2): SequenceSwitch calls
// `router.refresh()` on a successful toggle. The page is `force-dynamic`, so
// a fresh `initialSteps` comes back down and StepEditor's own effect resets
// all local editable state from it — discarding whatever a coach had typed,
// silently, in EITHER direction (turning on or off), with no prompt and no
// toast. StepEditor reports its own dirtiness here; SequenceSwitch reads it
// before acting, so it can ask first instead of throwing the edits away.
//
// THE DEFAULT VALUE IS THE SAFE ONE. SequenceSwitch also renders on
// /admin/sequences (SequenceReportTable), which has no step editor and never
// wraps in StepEditorDirtyProvider. `useContext` there returns this file's
// default — `dirty: false`, a no-op `setDirty` — so that screen's behaviour
// is completely unchanged: this hook must never throw for "no provider",
// only fall back to "nothing unsaved".

import { createContext, useContext } from "react"

type StepEditorDirtyContextValue = {
  dirty: boolean
  setDirty: (dirty: boolean) => void
}

const DEFAULT_VALUE: StepEditorDirtyContextValue = { dirty: false, setDirty: () => {} }

export const StepEditorDirtyContext = createContext<StepEditorDirtyContextValue>(DEFAULT_VALUE)

export function useStepEditorDirty(): StepEditorDirtyContextValue {
  return useContext(StepEditorDirtyContext)
}
