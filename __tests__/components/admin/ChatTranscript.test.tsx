// __tests__/components/admin/ChatTranscript.test.tsx
//
// The transcript is the only place a blocked turn can be explained after the
// fact, and that is the whole reason `chat_messages.fact_set` is persisted per
// message (spec §3). "The model said $120 and nothing in the fact set
// contained 120" is a claim somebody has to be able to CHECK — months later,
// without re-running the lookups — so the page has to show BOTH halves:
//
//   * the violations the validator returned, and
//   * the fact set the reply was checked against.
//
// Showing one without the other reduces the screen to "the computer said no".
//
// The page around it also carries the one audit slug in this branch that
// belongs to a READ rather than a write: `chat.transcript_viewed`,
// `admin_read_sensitive`, because a transcript is visitor-typed prose that can
// contain anything the visitor chose to type about themselves.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { render, cleanup, within } from "@testing-library/react"
import { ChatTranscript } from "@/components/admin/chat/ChatTranscript"
import { DataTableBadge } from "@/components/ui/data-table"
// `ChatMessage` is a NAME COLLISION — lib/validators/ai-chat.ts exports a
// different one (the admin program-builder transcript shape). The row type is
// imported explicitly and aliased so nothing here can pick up the wrong one.
import type { ChatMessage as ChatMessageRow, ChatConversation } from "@/types/database"

vi.mock("@/lib/auth-helpers", () => ({ requireAdmin: vi.fn() }))
vi.mock("@/lib/db/chat", () => ({ getConversation: vi.fn(), listMessages: vi.fn() }))
vi.mock("@/lib/audit/record", () => ({ recordAudit: vi.fn() }))
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
}))

import { requireAdmin } from "@/lib/auth-helpers"
import { getConversation, listMessages } from "@/lib/db/chat"
import { recordAudit } from "@/lib/audit/record"
import TranscriptPage from "@/app/(admin)/admin/chat/[id]/page"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

function message(over: Partial<ChatMessageRow> = {}): ChatMessageRow {
  return {
    id: "m-1",
    business_id: "b-1",
    conversation_id: "conv-1",
    role: "user",
    content: "how much is the throwing programme?",
    fact_set: {},
    cards: [],
    verdict: null,
    violations: [],
    tokens_input: null,
    tokens_output: null,
    model: null,
    created_at: "2026-08-20T09:00:00.000Z",
    ...over,
  }
}

const PROGRAMME_FACT = {
  kind: "programme",
  name: "Rotational Reboot",
  priceCents: 7900,
  durationWeeks: 6,
  sessionsPerWeek: 3,
  paymentType: "one_time",
}

const GROUNDED = ["79", "79.00", "7900", "$79", "6", "3"]

const ASKED = message({ id: "m-asked", role: "user" })

const BLOCKED = message({
  id: "m-blocked",
  role: "assistant",
  // The words the model actually wrote. NOT the refusal the visitor read.
  content: "The programme is $120.",
  verdict: "blocked",
  violations: [{ rule: "ungrounded_price", found: "120" }],
  fact_set: { facts: [PROGRAMME_FACT], groundedValues: GROUNDED },
  tokens_input: 900,
  tokens_output: 40,
  model: "claude-haiku",
  created_at: "2026-08-20T09:00:10.000Z",
})

const ANSWERED = message({
  id: "m-ok",
  role: "assistant",
  content: "It is $79 for six weeks.",
  verdict: "ok",
  fact_set: { facts: [PROGRAMME_FACT], groundedValues: GROUNDED },
  created_at: "2026-08-20T09:00:20.000Z",
})

const SHORT_CIRCUIT = message({
  id: "m-short",
  role: "assistant",
  content: "I'm not able to give advice about an injury.",
  verdict: "short_circuit",
  fact_set: { risk: "injury" },
  created_at: "2026-08-20T09:00:30.000Z",
})

const CONVERSATION: ChatConversation = {
  id: "conv-1",
  business_id: "b-1",
  contact_id: null,
  status: "open",
  ip_hash: "abc123",
  user_agent: "Mozilla/5.0",
  landing_path: "/",
  attribution_session_id: null,
  message_count: 4,
  tokens_used: 940,
  escalated_at: null,
  captured_at: null,
  last_activity_at: "2026-08-20T09:00:30.000Z",
  created_at: "2026-08-20T09:00:00.000Z",
}

/** Tone class strings read off the house badge, not copied out of it. */
function houseToneClasses(): Record<string, string> {
  const { container } = render(
    <>
      <DataTableBadge tone="neutral">neutral</DataTableBadge>
      <DataTableBadge tone="success">success</DataTableBadge>
      <DataTableBadge tone="warning">warning</DataTableBadge>
      <DataTableBadge tone="danger">danger</DataTableBadge>
    </>,
  )
  const tones: Record<string, string> = {}
  for (const badge of container.querySelectorAll('[data-slot="data-table-badge"]')) {
    tones[badge.textContent ?? ""] = badge.className
  }
  return tones
}

function turn(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector(`[data-slot="chat-turn"][data-message="${id}"]`)
  if (!el) throw new Error(`no turn rendered for ${id}`)
  return el as HTMLElement
}

beforeEach(() => {
  vi.resetAllMocks()
  asMock(requireAdmin).mockResolvedValue({ user: { id: "u1", role: "admin" } })
})

afterEach(() => {
  cleanup()
})

describe("a blocked turn is explainable months later", () => {
  it("shows a blocked turn's violations and the fact set it was checked against", () => {
    const { container } = render(<ChatTranscript messages={[ASKED, BLOCKED]} />)
    const blocked = within(turn(container, "m-blocked"))

    // The violation, in the validator's own vocabulary and with the value it
    // objected to — not a generic "this reply was blocked".
    expect(blocked.getByText(/why this reply was blocked/i)).toBeInTheDocument()
    const violations = blocked.getByTestId("violations").textContent ?? ""
    expect(violations).toContain("ungrounded_price")
    expect(violations).toContain("120")

    // And the other half — without it, "120 was not in the fact set" is an
    // assertion nobody can check.
    expect(blocked.getByText(/what it was checked against/i)).toBeInTheDocument()
    expect(blocked.getByText(/Rotational Reboot/)).toBeInTheDocument()
    const grounded = blocked.getByTestId("grounded-values").textContent ?? ""
    for (const value of GROUNDED) expect(grounded).toContain(value)
  })

  it("shows the words the blocked reply used, not the refusal the visitor read", () => {
    const { container } = render(<ChatTranscript messages={[ASKED, BLOCKED]} />)
    const blocked = within(turn(container, "m-blocked"))
    expect(blocked.getByText("The programme is $120.")).toBeInTheDocument()
  })

  it("badges every assistant turn with its verdict", () => {
    const tones = houseToneClasses()
    const { container } = render(<ChatTranscript messages={[ASKED, BLOCKED, ANSWERED, SHORT_CIRCUIT]} />)

    const badgeOf = (id: string): [string, string] => {
      const badge = turn(container, id).querySelector('[data-slot="data-table-badge"]')
      if (!badge) throw new Error(`no verdict badge on ${id}`)
      return [badge.textContent ?? "", badge.className]
    }

    expect(badgeOf("m-blocked")).toEqual(["Blocked", tones.danger])
    expect(badgeOf("m-ok")).toEqual(["Answered", tones.success])
    expect(badgeOf("m-short")).toEqual(["Fixed refusal", tones.warning])

    // A visitor's own message has no verdict, because nothing checked it.
    expect(turn(container, "m-asked").querySelector('[data-slot="data-table-badge"]')).toBeNull()
  })

  it("says the model was never called when a turn short-circuited", () => {
    const { container } = render(<ChatTranscript messages={[ASKED, SHORT_CIRCUIT]} />)
    const note = within(turn(container, "m-short")).getByTestId("short-circuit-note").textContent ?? ""
    expect(note).toMatch(/the model was never called/i)
    expect(note).toMatch(/injury/i)
  })

  it("keeps the fact set available on a clean turn too, folded away", () => {
    const { container } = render(<ChatTranscript messages={[ASKED, ANSWERED]} />)
    const ok = turn(container, "m-ok")
    const details = ok.querySelector("details")
    expect(details).not.toBeNull()
    expect(details?.hasAttribute("open")).toBe(false)
    expect(details?.textContent ?? "").toContain("Rotational Reboot")
  })
})

describe("opening a transcript is a sensitive read and is recorded as one", () => {
  it("records chat.transcript_viewed when an admin opens a transcript", async () => {
    asMock(getConversation).mockResolvedValue(CONVERSATION)
    asMock(listMessages).mockResolvedValue([ASKED, BLOCKED])

    render(await TranscriptPage({ params: Promise.resolve({ id: "conv-1" }) }))

    expect(recordAudit).toHaveBeenCalledTimes(1)
    expect(asMock(recordAudit).mock.calls[0][0]).toMatchObject({
      action: "chat.transcript_viewed",
      // Visitor-typed prose, which is why it is not `admin_read` — spec §7.3.
      category: "admin_read_sensitive",
      target: { type: "chat_conversation", id: "conv-1" },
    })
  })

  it("renders the transcript it just recorded a view of", async () => {
    asMock(getConversation).mockResolvedValue(CONVERSATION)
    asMock(listMessages).mockResolvedValue([ASKED, BLOCKED])

    const { container } = render(await TranscriptPage({ params: Promise.resolve({ id: "conv-1" }) }))
    expect(within(turn(container, "m-blocked")).getByTestId("violations").textContent).toContain("ungrounded_price")
  })

  it("does not record a view of a conversation that does not exist", async () => {
    asMock(getConversation).mockResolvedValue(null)

    await expect(TranscriptPage({ params: Promise.resolve({ id: "nope" }) })).rejects.toThrow("NEXT_NOT_FOUND")

    // A 404 is not a sensitive read. Recording one would put rows in
    // `audit_logs` for transcripts nobody ever saw — and would make the slug
    // useless as evidence of who read what.
    expect(recordAudit).not.toHaveBeenCalled()
  })

  it("never puts the visitor's raw address on the page — there is not one to put", async () => {
    // `chat_conversations` stores sha256(ip + salt) and never the address
    // itself (migration 00227). The hash is an internal join key, not
    // something an operator needs to read, so it does not reach the screen
    // either.
    asMock(getConversation).mockResolvedValue(CONVERSATION)
    asMock(listMessages).mockResolvedValue([ASKED, BLOCKED])

    const { container } = render(await TranscriptPage({ params: Promise.resolve({ id: "conv-1" }) }))
    expect(container.textContent ?? "").not.toContain(CONVERSATION.ip_hash)
  })
})
