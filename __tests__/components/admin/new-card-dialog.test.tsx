// @vitest-environment jsdom
// __tests__/components/admin/new-card-dialog.test.tsx
//
// G29 Task 8. The dialog a coach uses to put somebody on a board by hand —
// met at a camp, spoke to on the phone — plus the button on the board page
// that opens it.
//
// EVERY ASSERTION IS SCOPED. "dana@example.com appears somewhere in the
// dialog" passes just as well when the second result row is rendering the
// first one's email, so each result row is checked with `within(row)` for its
// OWN name/email/phone together, and at least one check proves the other
// row's values are NOT in it.
//
// TWO THINGS THIS FILE EXISTS TO HOLD ABOVE ALL:
//
//  1. ONE BRANCH PER SUBMISSION. The create route drops `person` silently if
//     `contactId` is also present, so the payload assertions check the exact
//     key set, not merely that the right value is in there somewhere.
//  2. THE SERVER'S REFUSAL, WORD FOR WORD. The duplicate-card message names
//     the person, the board and the stage; it is written to be read by a
//     coach. A generic "something went wrong" throws away the only useful
//     part, so the test pins the whole sentence.
//
// The dialog NEVER enrols anybody in a sequence — that is enforced
// structurally in the DAL, one layer below the route this posts to, and
// nothing here routes around that route.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { NewCardDialog } from "@/components/admin/new-card-dialog"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const refresh = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), refresh }),
}))

// The board page (bottom of this file) is an async server component. Its guard
// reaches auth() and its tenant resolver reads cookies(), neither of which
// exists outside a request scope — both mocked to sentinels, which is also what
// lets the DAL reads below be pinned to the RESOLVED tenant. `PipelineBoard` is
// mocked to a no-op so importing the page does not drag @dnd-kit in with it;
// what is under test here is the WIRING, not the board.
vi.mock("@/lib/permissions/guard", () => ({ requirePermission: vi.fn() }))
vi.mock("@/lib/tenancy/resolve", () => ({ resolveAdminTenant: vi.fn() }))
vi.mock("@/lib/db/pipeline", () => ({
  readBoard: vi.fn(),
  listPipelines: vi.fn(),
  listGrantablePrograms: vi.fn(),
}))
vi.mock("@/lib/db/businesses", () => ({ getBusinessSettings: vi.fn() }))
vi.mock("@/components/admin/pipeline-board", () => ({ PipelineBoard: () => null }))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { requirePermission } from "@/lib/permissions/guard"
import { resolveAdminTenant } from "@/lib/tenancy/resolve"
import { readBoard, listPipelines, listGrantablePrograms } from "@/lib/db/pipeline"
import { getBusinessSettings } from "@/lib/db/businesses"
import PipelinePage from "@/app/(admin)/admin/pipeline/page"
import type { BoardColumn } from "@/lib/db/pipeline"

const PIPELINE_ID = "pipe-coaching"
const BOARD_NAME = "Coaching"

// Two people whose every field DIFFERS, so a row rendering a sibling's data
// cannot pass by coincidence.
const DANA = {
  id: "c-dana",
  name: "Dana Reyes",
  email: "dana@example.com",
  phone_e164: "+12025550123",
  created_at: "2026-09-01T00:00:00.000Z",
}
const MARCUS = {
  id: "c-marcus",
  name: "Marcus Hale",
  email: "marcus@example.com",
  phone_e164: "+12025550456",
  created_at: "2026-09-02T00:00:00.000Z",
}

const CONTACTS_URL = "/api/admin/contacts"
const CREATE_URL = "/api/admin/pipeline/opportunities"

type Reply = { ok: boolean; status: number; body: unknown }

let fetchCalls: Array<{ url: string; init?: RequestInit }> = []
let searchReply: Reply
let createReply: Reply

function installFetch() {
  fetchCalls = []
  searchReply = { ok: true, status: 200, body: { contacts: [] } }
  createReply = { ok: true, status: 200, body: { ok: true, opportunityId: "opp-1", contactId: DANA.id } }
  global.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    fetchCalls.push({ url, init })
    const reply = url.startsWith(CONTACTS_URL) ? searchReply : createReply
    return { ok: reply.ok, status: reply.status, json: async () => reply.body }
  }) as unknown as typeof fetch
}

function searchCalls() {
  return fetchCalls.filter((c) => c.url.startsWith(CONTACTS_URL))
}

function createCalls() {
  return fetchCalls.filter((c) => c.url.startsWith(CREATE_URL))
}

/** The body of the most recent POST to the create route, parsed. */
function lastCreateBody<T = Record<string, unknown>>(): T {
  const calls = createCalls()
  expect(calls.length).toBeGreaterThan(0)
  return JSON.parse(calls[calls.length - 1].init!.body as string) as T
}

function openDialog(over: Partial<{ pipelineId: string; boardName: string; firstStageName: string | null }> = {}) {
  render(
    <NewCardDialog
      pipelineId={over.pipelineId ?? PIPELINE_ID}
      boardName={over.boardName ?? BOARD_NAME}
      firstStageName={over.firstStageName === undefined ? "Enquired" : over.firstStageName}
    />,
  )
  fireEvent.click(screen.getByRole("button", { name: "Add someone" }))
}

/** Types into the search box and waits for the rows that term should produce. */
async function search(term: string) {
  fireEvent.change(screen.getByLabelText("Search your contacts"), { target: { value: term } })
}

function resultRow(id: string) {
  return screen.getByTestId(`contact-result-${id}`)
}

function revealNewPerson() {
  fireEvent.click(screen.getByRole("button", { name: "Add someone new" }))
}

function fillPerson(fields: { name?: string; email?: string; phone?: string }) {
  if (fields.name !== undefined) {
    fireEvent.change(screen.getByLabelText("Their name"), { target: { value: fields.name } })
  }
  if (fields.email !== undefined) {
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: fields.email } })
  }
  if (fields.phone !== undefined) {
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: fields.phone } })
  }
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: `Add to ${BOARD_NAME}` }))
}

beforeEach(() => {
  vi.clearAllMocks()
  installFetch()
})

describe("<NewCardDialog> — finding somebody who is already a contact", () => {
  it("lists each match as its own row, with that person's own details", async () => {
    // MUTANT: render `results[0]` in every row, or key the row's email off the
    // wrong index. A document-wide `getByText` would pass; `within(row)` does
    // not.
    searchReply = { ok: true, status: 200, body: { contacts: [DANA, MARCUS] } }
    openDialog()
    await search("re")

    const dana = await screen.findByTestId(`contact-result-${DANA.id}`)
    expect(within(dana).getByText("Dana Reyes")).toBeInTheDocument()
    expect(within(dana).getByText(/dana@example\.com/)).toBeInTheDocument()
    expect(within(dana).getByText(/\+12025550123/)).toBeInTheDocument()
    // The other row's values are NOT in this one.
    expect(within(dana).queryByText(/marcus@example\.com/)).toBeNull()

    const marcus = resultRow(MARCUS.id)
    expect(within(marcus).getByText("Marcus Hale")).toBeInTheDocument()
    expect(within(marcus).getByText(/marcus@example\.com/)).toBeInTheDocument()
    expect(within(marcus).getByText(/\+12025550456/)).toBeInTheDocument()
    expect(within(marcus).queryByText(/dana@example\.com/)).toBeNull()
  })

  it("asks the search route for the typed term and a dropdown-sized page", async () => {
    // MUTANT: send no `limit`, and the route's default is still 20 — so this
    // also pins that the client asks for a small page rather than relying on
    // the server to save it.
    searchReply = { ok: true, status: 200, body: { contacts: [DANA] } }
    openDialog()
    await search("dana")

    await waitFor(() => expect(searchCalls().length).toBeGreaterThan(0))
    const url = searchCalls()[searchCalls().length - 1].url
    expect(url).toContain("search=dana")
    expect(url).toContain("limit=20")
  })

  it("does not search on a single letter", async () => {
    // MUTANT: drop the minimum length. One letter matches most of the contact
    // list and is never the search a coach meant; the control below proves the
    // box is not simply dead.
    openDialog()
    await search("d")
    await new Promise((r) => setTimeout(r, 400))
    expect(searchCalls()).toHaveLength(0)

    await search("da")
    await waitFor(() => expect(searchCalls().length).toBeGreaterThan(0))
  })

  it("says nobody matched, naming the term, instead of showing an empty box", async () => {
    // MUTANT: render nothing when there are no results — the coach cannot tell
    // "no match" from "still thinking" from "broken".
    searchReply = { ok: true, status: 200, body: { contacts: [] } }
    openDialog()
    await search("zzz")

    expect(await screen.findByText(/Nobody matched "zzz"/)).toBeInTheDocument()
  })

  it("shows the search route's own refusal rather than an empty result list", async () => {
    // MUTANT: swallow a failed search into `results = []`, which reads as
    // "this person is not in your contacts" and sends the coach off to create
    // a duplicate.
    searchReply = { ok: false, status: 500, body: { error: "Could not search your contacts right now." } }
    openDialog()
    await search("dana")

    expect(await screen.findByText("Could not search your contacts right now.")).toBeInTheDocument()
  })

  it("gives the result list its own scroll box", async () => {
    // The dialog primitive caps no height (components/ui/dialog.tsx sets no
    // max-height), so a long result list runs off the screen with no way back.
    // This repo has shipped that bug.
    searchReply = { ok: true, status: 200, body: { contacts: [DANA, MARCUS] } }
    openDialog()
    await search("re")

    const list = await screen.findByTestId("contact-results")
    expect(list.className).toMatch(/overflow-y-auto/)
    expect(list.className).toMatch(/max-h-/)
  })
})

describe("<NewCardDialog> — the two branches never overlap", () => {
  it("'Add someone new' reveals a name, an email and a phone box", () => {
    // The presence control comes first: the fields must be ABSENT before the
    // button is pressed, or "reveals" is unfalsifiable.
    openDialog()
    expect(screen.queryByLabelText("Their name")).toBeNull()
    expect(screen.queryByLabelText("Email address")).toBeNull()
    expect(screen.queryByLabelText("Phone number")).toBeNull()

    revealNewPerson()

    expect(screen.getByLabelText("Their name")).toBeInTheDocument()
    expect(screen.getByLabelText("Email address")).toBeInTheDocument()
    expect(screen.getByLabelText("Phone number")).toBeInTheDocument()
  })

  it("choosing a contact hides the new-person fields", async () => {
    // MUTANT: leave the new-person block open after a contact is chosen. Both
    // would then be filled in, and the route silently DROPS `person` when
    // `contactId` is present — so the coach's typing is discarded without a
    // word.
    searchReply = { ok: true, status: 200, body: { contacts: [DANA] } }
    openDialog()
    revealNewPerson()
    fillPerson({ name: "Dana R", email: "typo@example.com" })
    expect(screen.getByLabelText("Their name")).toBeInTheDocument() // control

    await search("dana")
    fireEvent.click(await screen.findByTestId(`contact-result-${DANA.id}`))

    expect(screen.queryByLabelText("Their name")).toBeNull()
    expect(screen.queryByLabelText("Email address")).toBeNull()
    const chosen = screen.getByTestId("chosen-contact")
    expect(within(chosen).getByText("Dana Reyes")).toBeInTheDocument()
  })

  it("'Add someone new' un-chooses a contact that was already picked", async () => {
    // The mirror of the test above, and the other half of "never both".
    searchReply = { ok: true, status: 200, body: { contacts: [DANA] } }
    openDialog()
    await search("dana")
    fireEvent.click(await screen.findByTestId(`contact-result-${DANA.id}`))
    expect(screen.getByTestId("chosen-contact")).toBeInTheDocument() // control

    revealNewPerson()

    expect(screen.queryByTestId("chosen-contact")).toBeNull()
  })
})

describe("<NewCardDialog> — what it sends", () => {
  it("files a chosen contact by id, and sends no person at all", async () => {
    // MUTANT: send `person` alongside `contactId`. The route drops `person`
    // silently, so the bug is invisible from the response — the exact key set
    // is the only thing that catches it.
    searchReply = { ok: true, status: 200, body: { contacts: [DANA] } }
    openDialog()
    await search("dana")
    fireEvent.click(await screen.findByTestId(`contact-result-${DANA.id}`))
    submit()

    await waitFor(() => expect(createCalls().length).toBe(1))
    const body = lastCreateBody()
    expect(body).toEqual({ pipelineId: PIPELINE_ID, contactId: DANA.id })
    expect(Object.keys(body).sort()).toEqual(["contactId", "pipelineId"])
  })

  it("files a new person with only the ways to reach them that were filled in", async () => {
    // MUTANT: send `email: ""` for a blank box. The route's PersonSchema is
    // `.strict()` with `email: z.string().trim().min(1).optional()`, so an
    // empty string is a 400 — the key must be ABSENT, not empty.
    openDialog()
    revealNewPerson()
    fillPerson({ name: "Jordan Webb", phone: "+12025550999" })
    submit()

    await waitFor(() => expect(createCalls().length).toBe(1))
    const body = lastCreateBody<{ pipelineId: string; person: Record<string, unknown> }>()
    expect(body.pipelineId).toBe(PIPELINE_ID)
    expect(body.person).toEqual({ name: "Jordan Webb", phone: "+12025550999" })
    expect(Object.keys(body).sort()).toEqual(["person", "pipelineId"])
  })

  it("refuses a new person with neither an email nor a phone, without asking the server", async () => {
    // MUTANT: drop the either/or rule and let the round trip discover it. The
    // sentence is the same one the create route answers with, so a coach who
    // gets past this box reads the same words either way.
    openDialog()
    revealNewPerson()
    fillPerson({ name: "Jordan Webb" })
    submit()

    expect(
      await within(screen.getByTestId("field-email")).findByText("Add an email or phone number for this person."),
    ).toBeInTheDocument()
    expect(createCalls()).toHaveLength(0)
  })

  it("refuses a new person with no name, and says so under the name box", async () => {
    openDialog()
    revealNewPerson()
    fillPerson({ email: "jordan@example.com" })
    submit()

    expect(await within(screen.getByTestId("field-name")).findByText("Add their name.")).toBeInTheDocument()
    expect(createCalls()).toHaveLength(0)
  })

  it("closes, says who landed where, and refreshes the board on success", async () => {
    searchReply = { ok: true, status: 200, body: { contacts: [DANA] } }
    openDialog()
    await search("dana")
    fireEvent.click(await screen.findByTestId(`contact-result-${DANA.id}`))
    submit()

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Dana Reyes is now on Coaching."))
    expect(refresh).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })
})

describe("<NewCardDialog> — the server's refusals", () => {
  it("shows the duplicate-card message word for word", async () => {
    // The whole point of R-what-a-coach-reads: this sentence names the person,
    // the board AND the stage. Anything generic throws away the only part
    // worth reading.
    const VERBATIM = "Dana Reyes is already on Coaching, in Consulted."
    searchReply = { ok: true, status: 200, body: { contacts: [DANA] } }
    createReply = { ok: false, status: 400, body: { error: VERBATIM } }
    openDialog()
    await search("dana")
    fireEvent.click(await screen.findByTestId(`contact-result-${DANA.id}`))
    submit()

    const slot = await screen.findByTestId("new-card-refusal")
    expect(within(slot).getByText(VERBATIM)).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith(VERBATIM)
    // Still open, with the chosen contact still chosen — a refusal is not a
    // reason to throw the coach's work away.
    expect(screen.getByTestId("chosen-contact")).toBeInTheDocument()
  })

  it("puts a refusal that names a field under THAT field, not at the foot of the dialog", async () => {
    // MUTANT: discard the route's `field` and render every refusal in one
    // slot. That is the exact bug fixed on this branch one task ago, where a
    // create refusal printed a screenful away from the box that caused it.
    createReply = {
      ok: false,
      status: 400,
      body: { error: "Name must be 200 characters or fewer.", field: "person.name" },
    }
    openDialog()
    revealNewPerson()
    fillPerson({ name: "Jordan Webb", email: "jordan@example.com" })
    submit()

    const nameField = await screen.findByTestId("field-name")
    expect(within(nameField).getByText("Name must be 200 characters or fewer.")).toBeInTheDocument()
    expect(screen.queryByTestId("new-card-refusal")).toBeNull()
  })

  it("puts a refusal the route did not attribute at the foot of the dialog", async () => {
    // The presence control for the test above: without it, a component that
    // put EVERY refusal under the name box would pass.
    createReply = {
      ok: false,
      status: 400,
      body: { error: '"Camps & Clinics" has been archived, so a card filed onto it would not show up anywhere.' },
    }
    openDialog()
    revealNewPerson()
    fillPerson({ name: "Jordan Webb", email: "jordan@example.com" })
    submit()

    const slot = await screen.findByTestId("new-card-refusal")
    expect(
      within(slot).getByText(
        '"Camps & Clinics" has been archived, so a card filed onto it would not show up anywhere.',
      ),
    ).toBeInTheDocument()
    expect(within(screen.getByTestId("field-name")).queryByRole("alert")).toBeNull()
  })

  it("says something readable when the request never reaches the server", async () => {
    global.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch")
    }) as unknown as typeof fetch
    openDialog()
    revealNewPerson()
    fillPerson({ name: "Jordan Webb", email: "jordan@example.com" })
    submit()

    const slot = await screen.findByTestId("new-card-refusal")
    expect(within(slot).getByText(/Check your connection/)).toBeInTheDocument()
  })
})

describe("<NewCardDialog> — what it tells the coach up front", () => {
  it("names the board and the step the card will land on", () => {
    // MUTANT: hard-code "the first step". `createOpportunityManually` files
    // onto the stage at position 1 by name, and a coach who has renamed that
    // stage should read their own word for it.
    openDialog({ boardName: "Camps & Clinics", firstStageName: "Met at a camp" })
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText(/Add someone to Camps & Clinics/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Met at a camp/)).toBeInTheDocument()
  })

  it("still reads as a sentence when the board's first step cannot be named", () => {
    openDialog({ firstStageName: null })
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText(/first step/)).toBeInTheDocument()
  })

  it("promises no email and no follow-up, because the route starts neither", () => {
    // Not decoration. A hand-filed card NEVER enrols anybody in a sequence
    // (enforced in the DAL), and the coach has no other way to know that.
    openDialog()
    expect(within(screen.getByRole("dialog")).getByText(/No email is sent/)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// The board page — the wiring, not the board.
//
// The dialog cannot verify its own `pipelineId`: handed the wrong board's id it
// behaves perfectly and files the card somewhere else. So these drive the page
// and read the id off the request that actually leaves.
// ---------------------------------------------------------------------------

const ADMIN_BUSINESS = "44444444-4444-4444-4444-444444444444"

/** Two boards whose ids, keys and names all differ — so picking the wrong one cannot coincide. */
const PAGE_BOARDS = [
  { id: "pipe-coaching", key: "coaching", name: "Coaching" },
  { id: "pipe-assessment", key: "assessment", name: "Assessment" },
]

function column(over: { id: string; key: string; name: string; position: number }): BoardColumn {
  return {
    stage: { ...over, kind: "open", amber_after_days: null, red_after_days: null },
    cards: [],
  }
}

function mockDal(over: Partial<{ boards: typeof PAGE_BOARDS; columns: BoardColumn[] }> = {}) {
  ;(requirePermission as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1", role: "admin" } })
  ;(resolveAdminTenant as ReturnType<typeof vi.fn>).mockResolvedValue({
    businessId: ADMIN_BUSINESS,
    choices: [],
    isOperator: true,
  })
  ;(listPipelines as ReturnType<typeof vi.fn>).mockResolvedValue(over.boards ?? PAGE_BOARDS)
  ;(listGrantablePrograms as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(getBusinessSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ display_name: "Trailhead Strength" })
  ;(readBoard as ReturnType<typeof vi.fn>).mockResolvedValue(
    over.columns ?? [
      // DELIBERATELY OUT OF ORDER. `readBoard` documents position order, but a
      // page that takes `columns[0]` instead of sorting would name the wrong
      // stage the day that changes — and the only symptom would be one wrong
      // word in a sentence nobody re-reads.
      column({ id: "st-2", key: "consulted", name: "Consulted", position: 2 }),
      column({ id: "st-1", key: "enquired", name: "Enquired", position: 1 }),
    ],
  )
}

async function renderPage(board?: string) {
  render(await PipelinePage({ searchParams: Promise.resolve(board === undefined ? {} : { board }) }))
}

describe("the board page's Add-someone button", () => {
  beforeEach(() => {
    mockDal()
  })

  it("files onto the board being looked at, not onto the default one", async () => {
    // MUTANT: pass `boards[0].id`, or the default board's id, instead of the
    // active board's. Everything still renders; the card lands on the wrong
    // board, which is the one failure a coach cannot see from the screen.
    await renderPage("assessment")

    fireEvent.click(screen.getByRole("button", { name: "Add someone" }))
    expect(screen.getByRole("button", { name: "Add to Assessment" })).toBeInTheDocument()

    revealNewPerson()
    fillPerson({ name: "Jordan Webb", email: "jordan@example.com" })
    fireEvent.click(screen.getByRole("button", { name: "Add to Assessment" }))

    await waitFor(() => expect(createCalls().length).toBe(1))
    expect(lastCreateBody().pipelineId).toBe("pipe-assessment")
  })

  it("names the stage at position 1, whatever order the board came back in", async () => {
    await renderPage("assessment")
    fireEvent.click(screen.getByRole("button", { name: "Add someone" }))

    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText(/Their card starts in "Enquired"/)).toBeInTheDocument()
    expect(within(dialog).queryByText(/Consulted/)).toBeNull()
  })

  it("offers nothing to click for a business with no boards at all", async () => {
    // `activeBoard` is undefined here, so there is no id to post. A button that
    // opened a dialog which could only ever 404 is worse than no button.
    mockDal({ boards: [], columns: [] })
    await renderPage()

    expect(screen.queryByRole("button", { name: "Add someone" })).toBeNull()
    // The presence control: the rest of the header still renders.
    expect(screen.getByRole("link", { name: /Edit stages/ })).toBeInTheDocument()
  })
})
