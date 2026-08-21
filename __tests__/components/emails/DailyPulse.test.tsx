import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { DailyPulse } from "@/components/emails/DailyPulse"
import type { DailyBriefPayload } from "@/types/coach-emails"

const MONDAY = new Date("2026-04-20T07:00:00Z") // Apr 20 2026 is a Monday
const TUESDAY = new Date("2026-04-21T07:00:00Z")

const basePipeline: DailyBriefPayload["pipeline"] = {
  awaitingReview: 3,
  readyToPublish: 2,
  scheduledToday: 1,
  videosAwaitingTranscription: 4,
  blogsInDraft: 0,
  blogsScheduled: 0,
  contentMissedSlot: 0,
}

function makePayload(overrides: Partial<DailyBriefPayload>): DailyBriefPayload {
  return {
    referenceDate: TUESDAY,
    isMondayEdition: false,
    bookings: null,
    coaching: null,
    clientRisk: null,
    inboxSla: null,
    pipeline: basePipeline,
    revenueFunnel: null,
    anomalies: null,
    trendingTopics: [],
    dashboardUrl: "https://app.local/admin/content",
    ...overrides,
  }
}

const trending: DailyBriefPayload["trendingTopics"] = [
  {
    title: "Hip flexor rotation drills",
    summary: "Athletes are losing power in sprint takeoffs",
    sourceUrl: "https://example.com/1",
  },
  {
    title: "Offseason nutrition for travel",
    summary: "Quick-prep meals that hold up in hotel rooms",
    sourceUrl: null,
  },
]

function render(payload: DailyBriefPayload): string {
  return renderToStaticMarkup(<DailyPulse payload={payload} />)
}

describe("<DailyPulse />", () => {
  it("renders pipeline counters in the main grid", () => {
    const html = render(makePayload({}))
    expect(html).toContain("Awaiting review")
    expect(html).toContain(">3<") // awaitingReview count
    expect(html).toContain("Videos to transcribe")
    expect(html).toContain(">4<") // videosAwaitingTranscription count
  })

  it("renders blog scheduled and missed-slot counters", () => {
    const html = render(makePayload({
      pipeline: { ...basePipeline, blogsScheduled: 2, contentMissedSlot: 1 },
    }))
    expect(html).toContain("Blog scheduled")
    expect(html).toContain("Missed their slot")
    expect(html).toContain("1 missed their scheduled slot")
  })

  it("uses 'Daily Brief' kicker on weekdays", () => {
    const html = render(makePayload({}))
    expect(html).toContain("Daily Brief")
    expect(html).not.toContain("Weekly kick-off")
  })

  it("uses 'Weekly kick-off' kicker on Monday", () => {
    const html = render(makePayload({ referenceDate: MONDAY, isMondayEdition: true, trendingTopics: trending }))
    expect(html).toContain("Weekly kick-off")
  })

  it("renders the trending block only on Monday when topics exist", () => {
    const html = render(makePayload({ referenceDate: MONDAY, isMondayEdition: true, trendingTopics: trending }))
    expect(html).toContain("Trending this week")
    expect(html).toContain("Hip flexor rotation drills")
    expect(html).toContain("https://example.com/1")
  })

  it("omits the trending block on weekdays even with topics supplied", () => {
    const html = render(makePayload({ isMondayEdition: false, trendingTopics: trending }))
    expect(html).not.toContain("Trending this week")
  })

  it("omits the trending block on Monday when topics list is empty", () => {
    const html = render(makePayload({ referenceDate: MONDAY, isMondayEdition: true, trendingTopics: [] }))
    expect(html).not.toContain("Trending this week")
  })

  it("shows a quiet morning message when no sections are active and pipeline is zero", () => {
    const html = render(makePayload({
      pipeline: {
        awaitingReview: 0,
        readyToPublish: 0,
        scheduledToday: 0,
        videosAwaitingTranscription: 0,
        blogsInDraft: 0,
        blogsScheduled: 0,
        contentMissedSlot: 0,
      },
    }))
    expect(html).toContain("Quiet morning")
  })

  it("includes the Open dashboard CTA linking to the dashboard", () => {
    const html = render(makePayload({}))
    expect(html).toContain("https://app.local/admin/content")
    expect(html).toContain("Open dashboard")
  })

  it("renders bookings section when non-null", () => {
    const html = render(makePayload({
      bookings: {
        callsToday: [{ time: "10:00 AM", clientName: "Alex P.", type: "Strategy call" }],
        newSignupsOvernight: 2,
      },
    }))
    expect(html).toContain("Today&#x27;s calls &amp; sessions")
    expect(html).toContain("Alex P.")
    expect(html).toContain("2 new event/clinic signups overnight")
  })

  it("renders anomalies section when non-null", () => {
    const html = render(makePayload({
      anomalies: { flags: [{ label: "Ad CPL spike", detail: "Yesterday $50 vs $10 avg" }] },
    }))
    expect(html).toContain("Anomalies")
    expect(html).toContain("Ad CPL spike")
  })

  it("renders the client-risk section with names, score, reasons", () => {
    const html = render(makePayload({
      clientRisk: {
        totalHigh: 2,
        totalMedium: 1,
        items: [
          { name: "Sarah K.", tier: "high", score: 75, reasons: ["no_session_30d", "frequency_lt_25"] },
          { name: "Mark P.", tier: "high", score: 60, reasons: ["renewal_unstarted"] },
          { name: "Jane R.", tier: "medium", score: 40, reasons: ["form_review_stale_10d"] },
        ],
      },
    }))
    expect(html).toContain("Clients needing reach-out")
    expect(html).toContain("2 high")
    expect(html).toContain("Sarah K.")
    expect(html).toContain("75/100")
    expect(html).toContain("no session 30d+")
    expect(html).toContain("renewal unstarted")
  })

  it("renders inbox-sla section and rolls awaiting-24h into the summary line", () => {
    const html = render(makePayload({
      inboxSla: {
        unreadCount: 7,
        awaitingReplyOver24h: 3,
        awaitingReplyOver48h: 1,
        meanResponseMinutes7d: 240,
        oldestUnanswered: [
          { contactName: "Coach Jen", hoursWaiting: 52.5, snippet: "Quick question on programming" },
        ],
      },
    }))
    expect(html).toContain("Inbox health")
    expect(html).toContain("<strong>7</strong> unread")
    expect(html).toContain("3 inbox &gt;24h")
    expect(html).toContain("Coach Jen")
  })

  it("rolls high-risk count into the summary line", () => {
    const html = render(makePayload({
      clientRisk: {
        totalHigh: 2,
        totalMedium: 0,
        items: [
          { name: "A", tier: "high", score: 75, reasons: [] },
          { name: "B", tier: "high", score: 70, reasons: [] },
        ],
      },
    }))
    expect(html).toContain("2 high-risk clients")
  })
})
