// __tests__/components/public/AskPanel.test.tsx
//
// The public chat surface. Everything this feature promises about honesty is
// enforced on the server — but the panel is the last hop, and there are three
// ways a client can undo all of it:
//
//   1. Compute a number. A price the browser worked out is a price nothing
//      validated. Money is `Intl.NumberFormat` over the server's integer cents
//      and nothing else, and a date is formatted in the timezone the site
//      stores it in — a camp shown a day early is a fabricated fact even
//      though every digit came from the database.
//   2. Show a consent tick that names nobody. `display_name` is `""` in
//      production and in the dev clone, so this is the DEFAULT state. The
//      capture route independently refuses to file a consent row in it; the
//      card must refuse to draw the tick in it, or the two disagree.
//   3. Post its own transcript. `askRequestSchema` has no history field
//      precisely so a browser cannot invent a prior assistant turn. The panel
//      must not try.
//
// Each test names the mutant it kills.
//
// A non-UTC timezone is pinned before anything imports a formatter: event
// datetimes are stored as WALL-CLOCK UTC (lib/events/format.ts), so a panel
// formatting them in the viewer's local zone would show a different time from
// the camps page. On a UTC runner that bug is invisible, which would make the
// date test vacuous — the test asserts the zone really took effect.
process.env.TZ = "America/Los_Angeles"

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AskPanel } from "@/components/public/AskPanel"
import { MAX_MESSAGES_PER_CONVERSATION } from "@/lib/lead-engine/chat/constants"
import {
  hasChatConsentDisplayName,
  renderChatContactWording,
  renderChatMarketingWording,
} from "@/lib/lead-engine/chat/consent-wording"
import type { Card } from "@/lib/lead-engine/chat/tools"

/** Invented, not the operator's. Nothing under lib/lead-engine may carry a real brand name. */
const DISPLAY_NAME = "Bay Performance"

const CONVERSATION_ID = "3f1b7c5e-1111-4222-8333-444444444444"

type AskResponse = { conversationId: string; reply: string; cards: Card[]; verdict: string }

function ok(body: Partial<AskResponse>): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ conversationId: CONVERSATION_ID, reply: "", cards: [], verdict: "ok", ...body }),
  } as Response
}

function refused(status: number, error: string): Response {
  return { ok: false, status, json: async () => ({ error }) } as Response
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** Type a question and send it, the way a visitor does. */
async function ask(text: string) {
  fireEvent.change(screen.getByLabelText("Your question"), { target: { value: text } })
  fireEvent.click(screen.getByRole("button", { name: "Send" }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
}

function lastBodyTo(path: string): Record<string, unknown> {
  const call = [...fetchMock.mock.calls].reverse().find(([url]) => url === path)
  if (!call) throw new Error(`nothing was posted to ${path}`)
  return JSON.parse((call[1] as RequestInit).body as string)
}

/**
 * Every money-shaped string on screen, so "no price the server did not send"
 * is checkable. Exactly two decimal places — `textContent` runs adjacent
 * elements together, so "$245.00" beside "4 places left" reads as one string
 * to a greedier pattern.
 */
function moneyOnScreen(container: HTMLElement): string[] {
  return [...(container.textContent ?? "").matchAll(/\$\s?[\d,]+(?:\.\d{2})?/g)].map((m) => m[0])
}

describe("AskPanel — the details card and its consent", () => {
  it("shows the consent card with the marketing tick when the assistant asks for details", async () => {
    fetchMock.mockResolvedValue(
      ok({
        reply: "I can pass this to a coach. Leave your details below and someone will come back to you.",
        cards: [{ kind: "capture", reason: "so a coach can come back to you" }],
      }),
    )

    render(<AskPanel displayName={DISPLAY_NAME} />)
    await ask("Can someone call me about the winter camp?")

    // The form itself.
    expect(await screen.findByLabelText("Your name")).toBeInTheDocument()
    expect(screen.getByLabelText("Email address")).toBeInTheDocument()
    expect(screen.getByLabelText("Phone number")).toBeInTheDocument()

    // The model's own words for why it asked, shown back.
    expect(screen.getByText(/so a coach can come back to you/)).toBeInTheDocument()

    // Both sentences EXACTLY as the resolver renders them — the marketing one
    // is what `/api/ask/capture` re-renders to file as `wording_shown`, so a
    // paraphrase here makes that row evidence of something else.
    expect(screen.getByText(renderChatContactWording(DISPLAY_NAME))).toBeInTheDocument()
    const tick = screen.getByRole("checkbox", { name: renderChatMarketingWording(DISPLAY_NAME) })
    expect(tick).not.toBeChecked()
  })

  it("does not render the marketing tick when no business name is configured", async () => {
    // `''` is what `business_settings.display_name` holds in production and in
    // the dev clone. This is the default state, not an edge case.
    expect(hasChatConsentDisplayName("")).toBe(false)

    fetchMock.mockResolvedValue(
      ok({
        reply: "Leave your details and someone will come back to you.",
        cards: [{ kind: "capture", reason: "so a coach can come back to you" }],
      }),
    )

    const { container } = render(<AskPanel displayName="" />)
    await ask("Can someone call me?")

    // The card still renders — otherwise "no tick" would be trivially true.
    expect(await screen.findByLabelText("Your name")).toBeInTheDocument()

    expect(screen.queryByRole("checkbox")).toBeNull()
    // And no half-written sentence with a hole where the business name goes.
    expect(container.textContent).not.toMatch(/I'd also like\s+to email me/)
    expect(container.textContent).not.toMatch(/I'm asking\s+to get in touch/)
  })

  it("posts the untouched contact fields as blank strings, which the capture route treats as absent", async () => {
    fetchMock.mockResolvedValue(
      ok({ reply: "Leave your details.", cards: [{ kind: "capture", reason: "so we can reach you" }] }),
    )

    render(<AskPanel displayName={DISPLAY_NAME} />)
    await ask("Call me please")
    await screen.findByLabelText("Your name")

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, marketingConsentRecorded: true }),
    } as Response)

    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Sam Okafor" } })
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "813-555-0117" } })
    fireEvent.click(screen.getByRole("checkbox", { name: renderChatMarketingWording(DISPLAY_NAME) }))
    fireEvent.click(screen.getByRole("button", { name: "Send my details" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/ask/capture", expect.anything()))

    // `blankToUndefined` in lib/validators/chat.ts already normalises the
    // untouched input away. A client that stripped it instead would be working
    // around a rule that is already handled, and would drift from it.
    expect(lastBodyTo("/api/ask/capture")).toEqual({
      conversationId: CONVERSATION_ID,
      name: "Sam Okafor",
      email: "",
      phone: "813-555-0117",
      marketingConsent: true,
    })
  })
})

describe("AskPanel — numbers come from the card, never from the client", () => {
  it("renders a price from the card, and the transcript contains no price the server did not send", async () => {
    fetchMock.mockResolvedValue(
      ok({
        // The model points at the card rather than retyping the number — the
        // common path, and the reason the common path cannot carry a made-up one.
        reply: "That one is on the card beside this message, with what it costs and how long it runs.",
        cards: [
          {
            kind: "programme",
            name: "Rotational Reboot",
            priceCents: 7900,
            durationWeeks: 8,
            sessionsPerWeek: 3,
            paymentType: "one_time",
          },
        ],
      }),
    )

    const { container } = render(<AskPanel displayName={DISPLAY_NAME} />)
    await ask("What does the rotational programme cost?")

    expect(await screen.findByText("Rotational Reboot")).toBeInTheDocument()
    expect(screen.getByText("$79.00")).toBeInTheDocument()
    expect(screen.getByText(/8 weeks/)).toBeInTheDocument()
    expect(screen.getByText(/3 sessions a week/)).toBeInTheDocument()

    // The ONLY money on screen is the server's integer, formatted. A weekly or
    // monthly figure worked out from it would be a number nothing validated.
    expect(moneyOnScreen(container)).toEqual(["$79.00"])
    // ...and the raw integer never leaks through unformatted.
    expect(container.textContent).not.toMatch(/7900/)
  })

  it("says the price is not published rather than showing a zero for a null", async () => {
    fetchMock.mockResolvedValue(
      ok({
        reply: "Here's what that one involves.",
        cards: [
          {
            kind: "programme",
            name: "Return To Play",
            priceCents: null,
            durationWeeks: 12,
            sessionsPerWeek: 2,
            paymentType: "subscription",
          },
        ],
      }),
    )

    const { container } = render(<AskPanel displayName={DISPLAY_NAME} />)
    await ask("What does the return programme cost?")

    await screen.findByText("Return To Play")
    // `null` is "we have not published one", not "$0.00" and not "free".
    expect(moneyOnScreen(container)).toEqual([])
    expect(container.textContent).not.toMatch(/free/i)
    expect(screen.getByText(/price isn't published/i)).toBeInTheDocument()
  })

  it("renders an event's dates in the timezone the site stores them in", async () => {
    // Self-check: if TZ did not take effect, local and UTC agree and this test
    // would pass without proving anything.
    expect(new Date("2026-07-13T09:00:00.000Z").getHours()).not.toBe(9)

    fetchMock.mockResolvedValue(
      ok({
        reply: "There's one on the schedule — the dates are on the card.",
        cards: [
          {
            kind: "event",
            title: "Summer Rotational Camp",
            type: "camp",
            startDate: "2026-07-13T09:00:00.000Z",
            endDate: "2026-07-17T11:00:00.000Z",
            locationName: "Riverside Field House",
            priceCents: 24500,
            capacity: 20,
            spotsLeft: 4,
            soldOut: false,
          },
        ],
      }),
    )

    const { container } = render(<AskPanel displayName={DISPLAY_NAME} />)
    await ask("When is the next camp?")

    await screen.findByText("Summer Rotational Camp")
    // Wall-clock UTC, exactly as /camps renders it. In the viewer's local zone
    // this would read "2:00 AM – 4:00 AM" and start a day earlier.
    expect(container.textContent).toMatch(/Jul 13 – Jul 17, 2026/)
    expect(container.textContent).toMatch(/9:00 AM – 11:00 AM/)
    expect(screen.getByText("Riverside Field House")).toBeInTheDocument()
    expect(screen.getByText(/4 places left/)).toBeInTheDocument()
    expect(moneyOnScreen(container)).toEqual(["$245.00"])
  })
})

describe("AskPanel — what it sends, and what it does when it is refused", () => {
  it("posts only the message and the conversation id — never a transcript", async () => {
    fetchMock.mockResolvedValue(ok({ reply: "Sessions run twice a week." }))

    render(<AskPanel displayName={DISPLAY_NAME} />)
    await ask("How often do people train?")
    await screen.findByText("Sessions run twice a week.")

    expect(lastBodyTo("/api/ask")).toEqual({ message: "How often do people train?" })

    fetchMock.mockClear()
    await ask("And how long is a session?")

    // The id the server handed back, and nothing else. A client that posted
    // its own history could invent a prior ASSISTANT turn and have the model
    // honour its own fabrication — which is why the schema has no field for it.
    expect(lastBodyTo("/api/ask")).toEqual({
      conversationId: CONVERSATION_ID,
      message: "And how long is a session?",
    })
  })

  it("shows a calm message on 429 rather than an error", async () => {
    const CALM = "That's a lot of questions at once. Give it a minute and try again."
    fetchMock.mockResolvedValue(refused(429, CALM))

    const { container } = render(<AskPanel displayName={DISPLAY_NAME} />)
    await ask("hello?")

    // The server's own copy, written for the visitor. Not a status code, not a
    // stack, not "something went wrong".
    expect(await screen.findByText(CALM)).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/error/i)
    expect(container.textContent).not.toMatch(/429/)
    expect(container.textContent).not.toMatch(/went wrong/i)

    // A rate limit is temporary, so the composer stays open.
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled()
  })

  it("disables the composer once the conversation cap is reached", async () => {
    fetchMock.mockResolvedValue(ok({ reply: "Noted." }))

    render(<AskPanel displayName={DISPLAY_NAME} />)

    // The server counts BOTH sides: `message_count` is an exact COUNT of
    // `chat_messages`, so one exchange is two rows.
    const turns = MAX_MESSAGES_PER_CONVERSATION / 2

    for (let i = 0; i < turns - 1; i++) {
      await ask(`question ${i}`)
      await waitFor(() => expect(screen.getAllByText("Noted.")).toHaveLength(i + 1))
    }
    // One short of the cap: still open. Asserted on the FIELD, because the
    // send button is also disabled on an empty draft and would read as
    // "capped" for the wrong reason.
    expect(screen.getByLabelText("Your question")).toBeEnabled()

    await ask(`question ${turns - 1}`)
    await waitFor(() => expect(screen.getAllByText("Noted.")).toHaveLength(turns))

    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled()
    expect(screen.getByLabelText("Your question")).toBeDisabled()
    expect(screen.getByText(/start a new one/i)).toBeInTheDocument()
  })

  it("renders the assistant's reply as text, never as markup", async () => {
    fetchMock.mockResolvedValue(ok({ reply: "<img src=x onerror=alert(1)> ask the coach" }))

    const { container } = render(<AskPanel displayName={DISPLAY_NAME} />)
    await ask("hi")

    await screen.findByText(/ask the coach/)
    // No element was created, and the tag is in the DOM as ESCAPED TEXT —
    // which is the positive evidence, since `onerror` survives escaping as
    // characters and a bare "innerHTML has no onerror" check would pass on a
    // component that stripped the string instead of escaping it.
    expect(container.querySelector("img")).toBeNull()
    expect(container.innerHTML).toContain("&lt;img src=x onerror=alert(1)&gt;")
  })
})
