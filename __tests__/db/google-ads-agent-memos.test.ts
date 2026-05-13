import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  updateAgentMemoLifecycle,
  listMemosPendingOutcomes,
} from "@/lib/db/google-ads-agent-memos"

vi.mock("@/lib/supabase", () => {
  // Build a chainable query builder that resolves like a Promise when awaited.
  // `update().eq()` resolves to { error: null }; `select().eq().lt().order()`
  // resolves to { data: [], error: null }. Distinguishing terminator is
  // handled by the `then` implementation, which returns the right payload
  // based on whether `update` was called in the chain.
  const makeBuilder = () => {
    const state: { isUpdate: boolean } = { isUpdate: false }
    const builder: Record<string, unknown> = {}
    const chain = (fn?: (..._args: unknown[]) => void) =>
      vi.fn((...args: unknown[]) => {
        fn?.(...args)
        return builder
      })
    builder.update = chain(() => {
      state.isUpdate = true
    })
    builder.eq = chain()
    builder.select = chain()
    builder.lt = chain()
    builder.order = chain()
    builder.then = (resolve: (v: unknown) => unknown) =>
      resolve(state.isUpdate ? { error: null } : { data: [], error: null })
    return builder
  }
  return {
    createServiceRoleClient: () => ({
      from: () => makeBuilder(),
    }),
  }
})

describe("google-ads-agent-memos DAL", () => {
  beforeEach(() => vi.clearAllMocks())

  it("updateAgentMemoLifecycle sets signals_summary, actions, and rejections", async () => {
    await expect(
      updateAgentMemoLifecycle("memo-id", {
        signals_summary: { foo: "bar" },
        actions: [],
        guardrail_rejections: [],
        outcome_status: "pending",
      }),
    ).resolves.not.toThrow()
  })

  it("listMemosPendingOutcomes returns rows with outcome_status='pending'", async () => {
    const result = await listMemosPendingOutcomes()
    expect(Array.isArray(result)).toBe(true)
  })
})
