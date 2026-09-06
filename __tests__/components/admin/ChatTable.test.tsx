// @vitest-environment jsdom
// __tests__/components/admin/ChatTable.test.tsx
//
// The admin list for the public chat assistant. Four properties are
// load-bearing rather than cosmetic, and each one has already gone wrong
// somewhere in this repo:
//
//   1. IT IS THE HOUSE TABLE. /admin/team invented its own — a grey header
//      bar, tighter rows, square corners — and reads as a different app.
//      CLAUDE.md records it. A source assertion is the only thing that can
//      catch a hand-rolled `<table>`, because a hand-rolled one renders
//      perfectly well and every behavioural test below would still pass.
//   2. THE BADGE TONE IS THE SUMMARY. An operator scanning this list is
//      reading colour before words: escalated `warning`, captured `success`,
//      blocked `danger`, answered `neutral` (spec §6.3). The tones are
//      compared against ones rendered from `components/ui/data-table.tsx`
//      itself rather than against hardcoded class strings, so this test pins
//      WHICH TONE, not which utility classes the house badge happens to use.
//   3. AN EMPTY STATE IS NOT AN EMPTY TABLE, and a filtered empty state is
//      not an unfiltered one. "No conversations yet" under an `Escalated`
//      filter is a lie about the database.
//   4. THE FILTER LIVES IN THE URL, the /admin/contacts precedent — a
//      filtered view is a link somebody can bookmark and send.
//
// And the property that belongs to the PAGE rather than to this component:
// a failed read must not render as an empty list. That one is asserted
// against the page's source, because there is no way to render "the read
// threw" and "there are no rows" and see a difference — which is exactly the
// point.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { render, cleanup, fireEvent, within } from "@testing-library/react"
import { readFileSync } from "fs"
import { ChatTable } from "@/components/admin/chat/ChatTable"
import { DataTableBadge } from "@/components/ui/data-table"
import type { ChatConversationListRow } from "@/lib/db/chat"

// `__tests__/setup.tsx` mocks next/navigation with a FRESH vi.fn() per
// useRouter() call, so nothing there can be asserted on. The filter test
// below needs to see the URL that was pushed, so this file supplies a stable
// router — the same shape `contacts-table.test.tsx` uses.
const pushMock = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/chat",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}))

function row(over: Partial<ChatConversationListRow> = {}): ChatConversationListRow {
  return {
    id: "conv-plain",
    created_at: "2026-08-20T09:00:00.000Z",
    last_activity_at: "2026-08-20T09:04:00.000Z",
    message_count: 4,
    tokens_used: 1200,
    landing_path: "/",
    escalated_at: null,
    captured_at: null,
    contact_id: null,
    blocked_count: 0,
    ...over,
  }
}

const ESCALATED = row({ id: "conv-escalated", escalated_at: "2026-08-20T09:05:00.000Z" })
const CAPTURED = row({ id: "conv-captured", captured_at: "2026-08-20T09:06:00.000Z", contact_id: "contact-1" })
const BLOCKED = row({ id: "conv-blocked", blocked_count: 2 })
const ANSWERED = row({ id: "conv-answered" })

function renderTable(over: Partial<React.ComponentProps<typeof ChatTable>> = {}) {
  return render(
    <ChatTable
      conversations={[ESCALATED, CAPTURED, BLOCKED, ANSWERED]}
      total={4}
      page={1}
      pageSize={25}
      filters={{ show: "all" }}
      {...over}
    />,
  )
}

/**
 * The class string the house badge produces for each tone, read off the house
 * component rather than copied out of it. A test that hardcoded
 * "bg-accent/15 text-accent" would go green the day someone restyled the
 * badge and red for a reason that has nothing to do with this list.
 */
function houseToneClasses(): Record<string, string> {
  const { container } = render(
    <>
      <DataTableBadge tone="neutral">neutral</DataTableBadge>
      <DataTableBadge tone="success">success</DataTableBadge>
      <DataTableBadge tone="warning">warning</DataTableBadge>
      <DataTableBadge tone="danger">danger</DataTableBadge>
      <DataTableBadge tone="info">info</DataTableBadge>
    </>,
  )
  const tones: Record<string, string> = {}
  for (const badge of container.querySelectorAll('[data-slot="data-table-badge"]')) {
    tones[badge.textContent ?? ""] = badge.className
  }
  return tones
}

/** Every badge in one row, in order, as `[text, className]` pairs. */
function badgesIn(scope: Element): Array<[string, string]> {
  return Array.from(scope.querySelectorAll('[data-slot="data-table-badge"]')).map((badge) => [
    badge.textContent ?? "",
    badge.className,
  ])
}

function rowFor(container: HTMLElement, id: string): HTMLElement {
  const link = container.querySelector(`a[href^="/admin/chat/${id}"]`)
  const tr = link?.closest('[data-slot="data-table-row"]')
  if (!tr) throw new Error(`no row rendered for ${id}`)
  return tr as HTMLElement
}

beforeEach(() => {
  vi.resetAllMocks()
})

afterEach(() => {
  cleanup()
})

describe("ChatTable is the house table", () => {
  it("uses the house data-table, not a hand-rolled table", () => {
    const src = readFileSync("components/admin/chat/ChatTable.tsx", "utf8")
    expect(src).not.toMatch(/<table[\s>]/)
    expect(src).toContain("DataTableCard")
  })

  it("is light-only, like the rest of the admin", () => {
    // `.dark` is a class variant these components were never built against —
    // forcing it breaks existing pages too, so a new one must not reach for it.
    const src = readFileSync("components/admin/chat/ChatTable.tsx", "utf8")
    expect(src).not.toMatch(/\bdark:/)
  })
})

describe("ChatTable badges say what happened", () => {
  it("badges an escalated conversation warning and a blocked one danger", () => {
    const tones = houseToneClasses()
    const { container } = renderTable()

    // toEqual on the WHOLE list, not toContainEqual on one entry: a change
    // that ADDS a badge to a row is exactly the kind of drift a contains-check
    // cannot see, and two pills disagreeing about one conversation is worse
    // than the wrong pill.
    expect(badgesIn(rowFor(container, "conv-escalated"))).toEqual([["Escalated", tones.warning]])
    expect(badgesIn(rowFor(container, "conv-blocked"))).toEqual([["2 blocked", tones.danger]])
  })

  it("badges a captured conversation success and an ordinary one neutral", () => {
    const tones = houseToneClasses()
    const { container } = renderTable()

    expect(badgesIn(rowFor(container, "conv-captured"))).toEqual([["Captured", tones.success]])
    expect(badgesIn(rowFor(container, "conv-answered"))).toEqual([["Answered", tones.neutral]])
  })

  it("shows every outcome a single conversation had, not just the first", () => {
    const tones = houseToneClasses()
    const both = row({
      id: "conv-both",
      escalated_at: "2026-08-20T09:05:00.000Z",
      captured_at: "2026-08-20T09:06:00.000Z",
      blocked_count: 1,
    })
    const { container } = renderTable({ conversations: [both], total: 1 })

    expect(badgesIn(rowFor(container, "conv-both"))).toEqual([
      ["Escalated", tones.warning],
      ["Captured", tones.success],
      ["1 blocked", tones.danger],
    ])
  })

  it("links each row to its own transcript", () => {
    const { container } = renderTable()
    const link = within(rowFor(container, "conv-escalated")).getByRole("link", { name: /view the transcript/i })
    expect(link).toHaveAttribute("href", "/admin/chat/conv-escalated")
  })
})

describe("ChatTable says why the list is empty", () => {
  it("renders an empty state that is not an empty table", () => {
    const { container } = renderTable({ conversations: [], total: 0 })

    const empty = container.querySelector('[data-slot="data-table-empty"]')
    expect(empty).not.toBeNull()
    expect(empty?.textContent ?? "").toMatch(/no conversations yet/i)

    // The header is still there — this is a table saying nothing is in it,
    // not a card that decided to render nothing at all.
    expect(container.querySelector('[data-slot="data-table-header"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-slot="data-table-row"]')).toHaveLength(0)
  })

  it("blames the filter rather than the database when a filter is hiding the rows", () => {
    const { container } = renderTable({ conversations: [], total: 0, filters: { show: "escalated" } })

    const empty = container.querySelector('[data-slot="data-table-empty"]')
    expect(empty?.textContent ?? "").toMatch(/no conversations match this filter/i)
    expect(empty?.textContent ?? "").not.toMatch(/no conversations yet/i)
  })
})

describe("ChatTable keeps the filter in the URL", () => {
  it("pushes the filter into the query string so a filtered view can be shared", () => {
    const { container } = renderTable()
    const select = container.querySelector("select")
    if (!select) throw new Error("no filter select rendered")

    fireEvent.change(select, { target: { value: "escalated" } })

    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock.mock.calls[0][0]).toBe("/admin/chat?show=escalated")
  })

  it("re-syncs the filter box when the URL changes underneath it", () => {
    // The select is held locally so it moves the instant it is clicked. Going
    // BACKWARDS — the browser's Back button — changes the rows without
    // changing local state, and the box would then say "Every conversation"
    // over a table showing only the escalated ones.
    const { container, rerender } = renderTable({
      filters: { show: "escalated" },
      conversations: [ESCALATED],
      total: 1,
    })
    expect((container.querySelector("select") as HTMLSelectElement).value).toBe("escalated")

    rerender(
      <ChatTable conversations={[ESCALATED, CAPTURED]} total={2} page={1} pageSize={25} filters={{ show: "all" }} />,
    )

    expect((container.querySelector("select") as HTMLSelectElement).value).toBe("all")
  })

  it("drops the default filter from the URL instead of writing show=all", () => {
    const { container } = renderTable({ filters: { show: "escalated" } })
    const select = container.querySelector("select")
    if (!select) throw new Error("no filter select rendered")

    fireEvent.change(select, { target: { value: "all" } })

    expect(pushMock.mock.calls[0][0]).toBe("/admin/chat")
  })
})

describe("the list page tells a failed read apart from an empty one", () => {
  it("does not wrap its reads in try/catch, so a failed read reaches the admin error page", () => {
    // Same reasoning as app/(admin)/admin/contacts/page.tsx and
    // app/(admin)/admin/pipeline/page.tsx. "The read failed" and "nobody has
    // used the assistant" must not look the same, and the only rendering that
    // is visibly not a table with no rows in it is the error boundary.
    const src = readFileSync("app/(admin)/admin/chat/page.tsx", "utf8")
    expect(src).not.toMatch(/\btry\s*\{/)
    expect(src).not.toMatch(/\bcatch\s*[({]/)
  })
})
