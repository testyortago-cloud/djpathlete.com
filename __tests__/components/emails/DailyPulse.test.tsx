import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { DailyPulse } from "@/components/emails/DailyPulse"
import type { DailyPulsePipeline, DailyPulseTrendingTopic } from "@/components/emails/DailyPulse"

const MONDAY = new Date("2026-04-20T07:00:00Z") // Apr 20 2026 is a Monday
const TUESDAY = new Date("2026-04-21T07:00:00Z")

const basePipeline: DailyPulsePipeline = {
  awaitingReview: 3,
  readyToPublish: 2,
  scheduledToday: 1,
  videosAwaitingTranscription: 4,
  blogsInDraft: 0,
}

const trending: DailyPulseTrendingTopic[] = [
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

function render(props: Parameters<typeof DailyPulse>[0]): string {
  return renderToStaticMarkup(<DailyPulse {...props} />)
}

describe("<DailyPulse />", () => {
  it("renders pipeline counters in the main grid", () => {
    const html = render({
      referenceDate: TUESDAY,
      pipeline: basePipeline,
      trendingTopics: [],
      dashboardUrl: "https://app.local/admin/content",
    })
    expect(html).toContain("Awaiting review")
    expect(html).toContain(">3<") // awaitingReview count
    expect(html).toContain("Videos to transcribe")
    expect(html).toContain(">4<") // videosAwaitingTranscription count
  })

  it("uses 'Daily Pulse' kicker on weekdays", () => {
    const html = render({
      referenceDate: TUESDAY,
      pipeline: basePipeline,
      trendingTopics: [],
      dashboardUrl: "https://app.local/admin/content",
    })
    expect(html).toContain("Daily Pulse")
    expect(html).not.toContain("Weekly kick-off")
  })

  it("uses 'Weekly kick-off' kicker on Monday", () => {
    const html = render({
      referenceDate: MONDAY,
      pipeline: basePipeline,
      trendingTopics: trending,
      dashboardUrl: "https://app.local/admin/content",
    })
    expect(html).toContain("Weekly kick-off")
  })

  it("renders the trending block only on Monday when topics exist", () => {
    const html = render({
      referenceDate: MONDAY,
      pipeline: basePipeline,
      trendingTopics: trending,
      dashboardUrl: "https://app.local/admin/content",
    })
    expect(html).toContain("Trending this week")
    expect(html).toContain("Hip flexor rotation drills")
    expect(html).toContain("https://example.com/1")
  })

  it("omits the trending block on weekdays even with topics supplied", () => {
    const html = render({
      referenceDate: TUESDAY,
      pipeline: basePipeline,
      trendingTopics: trending,
      dashboardUrl: "https://app.local/admin/content",
    })
    expect(html).not.toContain("Trending this week")
  })

  it("omits the trending block on Monday when topics list is empty", () => {
    const html = render({
      referenceDate: MONDAY,
      pipeline: basePipeline,
      trendingTopics: [],
      dashboardUrl: "https://app.local/admin/content",
    })
    expect(html).not.toContain("Trending this week")
  })

  it("shows an 'inbox zero' message when every counter is zero", () => {
    const html = render({
      referenceDate: TUESDAY,
      pipeline: {
        awaitingReview: 0,
        readyToPublish: 0,
        scheduledToday: 0,
        videosAwaitingTranscription: 0,
        blogsInDraft: 0,
      },
      trendingTopics: [],
      dashboardUrl: "https://app.local/admin/content",
    })
    expect(html).toContain("Inbox zero")
  })

  it("includes the Open pipeline CTA linking to the dashboard", () => {
    const html = render({
      referenceDate: TUESDAY,
      pipeline: basePipeline,
      trendingTopics: [],
      dashboardUrl: "https://app.local/admin/content",
    })
    expect(html).toContain("https://app.local/admin/content")
    expect(html).toContain("Open pipeline")
  })
})
