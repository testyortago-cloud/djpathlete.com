// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, act } from "@testing-library/react"
import { useEffect } from "react"

// Controllable stand-in for firebase/firestore's onSnapshot — lets the test
// fire job-doc and chunk events on demand instead of hitting real Firestore.
type Listener = (snap: unknown) => void
const jobListeners = new Map<string, Listener>()
const chunksListeners = new Map<string, Listener>()

vi.mock("@/lib/firebase", () => ({ db: {} }))

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, _col: string, jobId: string) => ({ __kind: "jobRef" as const, jobId }),
  collection: (_db: unknown, _col: string, jobId: string, _sub: string) => ({
    __kind: "chunksCol" as const,
    jobId,
  }),
  query: (ref: unknown) => ref,
  orderBy: () => ({}),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  onSnapshot: (ref: { __kind: "jobRef" | "chunksCol"; jobId: string }, onNext: Listener) => {
    const map = ref.__kind === "jobRef" ? jobListeners : chunksListeners
    map.set(ref.jobId, onNext)
    return () => map.delete(ref.jobId)
  },
}))

import { useAiJob } from "@/hooks/use-ai-job"

function emitJobDoc(jobId: string, data: Record<string, unknown>) {
  jobListeners.get(jobId)?.({ exists: () => true, data: () => data })
}

function emitChunk(jobId: string, chunk: { index: number; type: string; data: Record<string, unknown> }) {
  chunksListeners.get(jobId)?.({
    docChanges: () => [{ type: "added", doc: { data: () => chunk } }],
  })
}

/** Mirrors AdminAiChat's real shape: useAiJob(jobId) feeding a downstream
 *  effect that reacts to status/text changes — the exact composition the
 *  stale-state race condition lived in. */
function Harness({
  jobId,
  onObserve,
}: {
  jobId: string | null
  onObserve: (o: { jobId: string | null; status: string; text: string }) => void
}) {
  const aiJob = useAiJob(jobId)
  useEffect(() => {
    onObserve({ jobId, status: aiJob.status, text: aiJob.text })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, aiJob.status, aiJob.text])
  return null
}

beforeEach(() => {
  jobListeners.clear()
  chunksListeners.clear()
})

describe("useAiJob", () => {
  it("streams delta chunks into text and reflects job-doc status", () => {
    const observations: { jobId: string | null; status: string; text: string }[] = []
    render(<Harness jobId="jobA" onObserve={(o) => observations.push(o)} />)

    act(() => emitChunk("jobA", { index: 0, type: "delta", data: { text: "Hello " } }))
    act(() => emitChunk("jobA", { index: 1, type: "delta", data: { text: "Tina" } }))
    act(() => emitJobDoc("jobA", { status: "completed" }))

    expect(observations.at(-1)).toEqual({ jobId: "jobA", status: "completed", text: "Hello Tina" })
  })

  it("never lets a downstream effect see a new jobId paired with the PREVIOUS job's finished answer", () => {
    // Regression test for the bug where switching from a completed job to a
    // fresh one showed the prior job's answer instantly, with no streaming
    // indicator — the previous job's data leaking into the new job's identity
    // for one render because the reset only ran in an effect, after commit.
    const observations: { jobId: string | null; status: string; text: string }[] = []
    const onObserve = (o: { jobId: string | null; status: string; text: string }) => observations.push(o)

    const { rerender } = render(<Harness jobId="jobA" onObserve={onObserve} />)

    act(() => emitChunk("jobA", { index: 0, type: "delta", data: { text: "Tina's answer" } }))
    act(() => emitJobDoc("jobA", { status: "completed" }))

    expect(
      observations.some((o) => o.jobId === "jobA" && o.status === "completed" && o.text === "Tina's answer"),
    ).toBe(true)

    // User sends the next message — a brand new job for a different client.
    rerender(<Harness jobId="jobB" onObserve={onObserve} />)

    const leaked = observations.find((o) => o.jobId === "jobB" && (o.status !== "pending" || o.text !== ""))
    expect(leaked).toBeUndefined()

    // jobB's own (different) answer streams in normally afterward.
    act(() => emitChunk("jobB", { index: 0, type: "delta", data: { text: "Aean's answer" } }))
    act(() => emitJobDoc("jobB", { status: "completed" }))

    expect(observations.at(-1)).toEqual({ jobId: "jobB", status: "completed", text: "Aean's answer" })
  })
})
