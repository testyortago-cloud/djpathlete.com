// @vitest-environment node
//
// getPublishedCheckoutOffers — what a step's PUBLISHED version offers for sale.
//
// G40: POST /api/funnels/checkout sold whatever program id its body named. It
// now sells only an id one of the page's own `checkout` islands names, read
// from the version row the step currently serves (never the draft, never the
// browser's word). This file pins the reader that answers "what does this page
// sell?", and the three ways it could answer wrongly:
//   - from another business's step that happens to share the id;
//   - from the draft instead of the published version;
//   - "nothing" when the read actually failed.

import { describe, it, expect, vi, beforeEach } from "vitest"

const A = "aaaaaaaa-0000-0000-0000-00000000000a"
const B = "bbbbbbbb-0000-0000-0000-00000000000b"
const PROGRAM_A = "11111111-1111-4111-8111-111111111111"
const PROGRAM_B = "22222222-2222-4222-8222-222222222222"
const PROGRAM_DRAFT = "33333333-3333-4333-8333-333333333333"
const PACK = "44444444-4444-4444-8444-444444444444"

// The published tree nests its islands inside elements, the way a real
// section renders: an island at the top level only would let a walk that
// forgets to recurse pass.
function page(...islands: Record<string, unknown>[]) {
  return [
    {
      t: "el",
      tag: "section",
      attrs: {},
      children: [
        { t: "text", v: "Buy the program" },
        {
          t: "el",
          tag: "div",
          attrs: {},
          children: islands.map((props) => ({ t: "island", name: "checkout", props })),
        },
      ],
    },
  ]
}

let tables: Record<string, Record<string, unknown>[]> = {}
let failOn: string | null = null
let captured: { table: string; col: string; val: unknown }[] = []

function makeQuery(table: string) {
  let current = [...(tables[table] ?? [])]
  const q: Record<string, unknown> = {}
  q.select = () => q
  q.eq = (col: string, val: unknown) => {
    captured.push({ table, col, val })
    current = current.filter((r) => r[col] === val)
    return q
  }
  q.maybeSingle = async () =>
    failOn === table
      ? { data: null, error: { code: "57014", message: `canceling statement on ${table}` } }
      : { data: current[0] ?? null, error: null }
  return q
}

vi.mock("@/lib/supabase", () => ({
  createServiceRoleClient: () => ({ from: (table: string) => makeQuery(table) }),
}))

import { getPublishedCheckoutOffers } from "@/lib/db/funnels"

beforeEach(() => {
  captured = []
  failOn = null
  // ONE step id, "s-shared", under both businesses, each serving a different
  // version with a different offer. Only the business_id predicate tells them
  // apart; a reader that drops it answers with whichever row comes first.
  tables = {
    funnel_steps: [
      { id: "s-shared", business_id: B, published_version_id: "v-b", project_data: {} },
      { id: "s-shared", business_id: A, published_version_id: "v-a", project_data: {} },
      { id: "s-never", business_id: A, published_version_id: null, project_data: {} },
      // A pointer at ANOTHER step's version. Only publishStep writes the
      // pointer, so this is corruption, not a flow; it must still offer nothing.
      { id: "s-crossed", business_id: A, published_version_id: "v-a", project_data: {} },
    ],
    funnel_step_versions: [
      {
        id: "v-b",
        step_id: "s-shared",
        business_id: B,
        nodes: page({ productKind: "program", productId: PROGRAM_B, label: "Buy" }),
      },
      {
        id: "v-a",
        step_id: "s-shared",
        business_id: A,
        nodes: page(
          { productKind: "program", productId: PROGRAM_A, label: "Buy" },
          { productKind: "session_pack", productId: PACK, label: "Buy a pack" },
        ),
      },
      // A LATER version that is not the one being served — the draft the owner
      // is still editing. It must never be read as an offer.
      {
        id: "v-a-draft",
        step_id: "s-shared",
        business_id: A,
        nodes: page({ productKind: "program", productId: PROGRAM_DRAFT }),
      },
    ],
  }
})

describe("getPublishedCheckoutOffers", () => {
  it("returns every checkout island in the SERVED version, nested or not, with its kind", async () => {
    const offers = await getPublishedCheckoutOffers(A, "s-shared")
    expect(offers).toEqual([
      { productKind: "program", productId: PROGRAM_A },
      { productKind: "session_pack", productId: PACK },
    ])
  })

  it("answers for the business it was given when another business has a step with the same id", async () => {
    // Permissive control first: each business sees its OWN offer.
    expect(await getPublishedCheckoutOffers(B, "s-shared")).toEqual([{ productKind: "program", productId: PROGRAM_B }])
    expect((await getPublishedCheckoutOffers(A, "s-shared")).map((o) => o.productId)).not.toContain(PROGRAM_B)
  })

  it("filters BOTH reads on the business_id VALUE it was given", async () => {
    await getPublishedCheckoutOffers(A, "s-shared")
    const predicates = captured.filter((c) => c.col === "business_id")
    expect(predicates.map((c) => c.table).sort()).toEqual(["funnel_step_versions", "funnel_steps"])
    for (const call of predicates) expect(call.val).toBe(A)
  })

  it("offers nothing from a step that has never been published", async () => {
    expect(await getPublishedCheckoutOffers(A, "s-never")).toEqual([])
    // It must not fall back to "the latest version" the way a preview does.
    expect(captured.some((c) => c.table === "funnel_step_versions")).toBe(false)
  })

  it("offers nothing when the step points at a version that belongs to ANOTHER step", async () => {
    expect(await getPublishedCheckoutOffers(A, "s-crossed")).toEqual([])
  })

  it("offers nothing for a step id it cannot find", async () => {
    expect(await getPublishedCheckoutOffers(A, "no-such-step")).toEqual([])
  })

  it("skips an island whose productId is not a string instead of offering it", async () => {
    tables.funnel_step_versions[1].nodes = page({ productKind: "program", productId: 42 }, { productKind: "program" })
    expect(await getPublishedCheckoutOffers(A, "s-shared")).toEqual([])
  })

  it.each(["funnel_steps", "funnel_step_versions"])(
    "THROWS when the %s read fails, rather than answering 'this page sells nothing'",
    async (table) => {
      // PostgREST answers {data:null, error} instead of throwing. Turned into an
      // empty list, a timeout would read as "not one of this page's offers" and
      // the buyer would be told the program is unavailable while it is on sale.
      failOn = table
      await expect(getPublishedCheckoutOffers(A, "s-shared")).rejects.toThrow(/getPublishedCheckoutOffers/)
    },
  )
})
