// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const snapshotHandlers = new Map<string, { next: (s: unknown) => void; error: (e: unknown) => void }>()
const unsubscribeSpy = vi.fn()
let docState: { exists: boolean; data: unknown } = { exists: false, data: null }
const getDocSpy = vi.fn()

vi.mock("@/lib/firebase", () => ({ db: {} }))
vi.mock("firebase/firestore", () => ({
  doc: vi.fn((_db: unknown, _collection: string, id: string) => ({ id })),
  getDoc: vi.fn(async (ref: { id: string }) => {
    getDocSpy(ref.id)
    return { exists: () => docState.exists, data: () => docState.data }
  }),
  onSnapshot: vi.fn(
    (ref: { id: string }, next: (s: unknown) => void, error: (e: unknown) => void) => {
      snapshotHandlers.set(ref.id, { next, error })
      return () => {
        unsubscribeSpy(ref.id)
        snapshotHandlers.delete(ref.id)
      }
    },
  ),
}))

import { subscribeToJob as rawSubscribeToJob } from "@/lib/firebase/job-subscription"

// jsdom's `document` is shared across tests in this file, so a subscription
// left open leaks its visibilitychange listener into later assertions. Track
// every subscription and tear them down between tests.
const open: Array<() => void> = []
function subscribeToJob(...args: Parameters<typeof rawSubscribeToJob>) {
  const unsubscribe = rawSubscribeToJob(...args)
  open.push(unsubscribe)
  return unsubscribe
}

function emitSnapshot(jobId: string, data: unknown) {
  snapshotHandlers.get(jobId)!.next({ exists: () => true, data: () => data })
}

/** Let the getDoc promise chain settle. */
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  snapshotHandlers.clear()
  unsubscribeSpy.mockClear()
  getDocSpy.mockClear()
  docState = { exists: false, data: null }
})

afterEach(() => {
  for (const unsubscribe of open.splice(0)) unsubscribe()
})

describe("subscribeToJob", () => {
  // The production failure this exists to fix: the job finished before the
  // browser subscribed, so the stream had nothing left to send and the dialog
  // sat at "Step 0 of 3" forever. The one-shot read is what rescues it.
  it("delivers the current state when the stream has no event left to send", async () => {
    docState = { exists: true, data: { status: "completed", result: { rows: [1] } } }
    const onData = vi.fn()

    subscribeToJob("job1", onData)
    expect(onData).not.toHaveBeenCalled() // async, never synchronous
    await flush()

    expect(onData).toHaveBeenCalledWith({ status: "completed", result: { rows: [1] } })
  })

  it("delivers live snapshot updates", async () => {
    const onData = vi.fn()
    subscribeToJob("job1", onData)
    await flush()

    emitSnapshot("job1", { status: "processing", progress: { status: "parsing", current_step: 1 } })
    expect(onData).toHaveBeenLastCalledWith({
      status: "processing",
      progress: { status: "parsing", current_step: 1 },
    })
  })

  it("stops delivering after unsubscribe, including an in-flight one-shot read", async () => {
    docState = { exists: true, data: { status: "completed" } }
    const onData = vi.fn()

    const unsubscribe = subscribeToJob("job1", onData)
    unsubscribe() // before the getDoc promise resolves
    await flush()

    expect(onData).not.toHaveBeenCalled()
    expect(unsubscribeSpy).toHaveBeenCalledWith("job1")
  })

  it("re-reads when the tab becomes visible again", async () => {
    const onData = vi.fn()
    subscribeToJob("job1", onData)
    await flush()
    expect(getDocSpy).toHaveBeenCalledTimes(1)

    document.dispatchEvent(new Event("visibilitychange"))
    await flush()

    expect(getDocSpy).toHaveBeenCalledTimes(2)
  })

  it("removes the visibility listener on unsubscribe", async () => {
    const onData = vi.fn()
    const unsubscribe = subscribeToJob("job1", onData)
    await flush()
    unsubscribe()
    getDocSpy.mockClear()

    document.dispatchEvent(new Event("visibilitychange"))
    await flush()

    expect(getDocSpy).not.toHaveBeenCalled()
  })

  it("reports stream errors to the caller", async () => {
    const onData = vi.fn()
    const onError = vi.fn()
    subscribeToJob("job1", onData, onError)
    await flush()

    snapshotHandlers.get("job1")!.error(new Error("permission denied"))
    expect(onError).toHaveBeenCalled()
  })

  it("never surfaces a missing document as data", async () => {
    docState = { exists: false, data: null }
    const onData = vi.fn()
    subscribeToJob("job1", onData)
    await flush()

    expect(onData).not.toHaveBeenCalled()
  })
})
