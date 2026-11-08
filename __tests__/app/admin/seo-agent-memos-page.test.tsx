// @vitest-environment jsdom
// Renders /admin/seo-agent/memos against two memos copied from the first real
// runs (2026-11-08). Pins what a coach sees and which button each action gets.
// Every lookup mock answers ONLY for the ids it is handed, so sending one
// kind of id to the wrong lookup (a calendar id to the notification read,
// say) shows up as a missing button, not a silent pass.
import { render, screen, within } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("@/lib/db/seo-agent-memos", () => ({ listMemos: vi.fn() }))
vi.mock("@/lib/db/blog-posts", () => ({ getBlogPostTitles: vi.fn() }))
vi.mock("@/lib/db/content-calendar", () => ({ getCalendarDraftRefs: vi.fn() }))
vi.mock("@/lib/db/notifications", () => ({ getNotificationReadStates: vi.fn() }))
vi.mock("@/lib/ai-jobs", () => ({ getAiJobSnapshots: vi.fn() }))

import { auth } from "@/lib/auth"
import { listMemos } from "@/lib/db/seo-agent-memos"
import { getBlogPostTitles } from "@/lib/db/blog-posts"
import { getCalendarDraftRefs } from "@/lib/db/content-calendar"
import { getNotificationReadStates } from "@/lib/db/notifications"
import { getAiJobSnapshots } from "@/lib/ai-jobs"
import Page from "@/app/(admin)/admin/seo-agent/memos/page"

const TARGET = "dd896e80-0546-4ca2-b228-1f53fb338772"
const ANCHOR = "1bc8988b-ed33-4d13-afef-4f234b9fa4a3"
const sweepArgs = { target_blog_post_id: TARGET, candidate_anchor_post_ids: [ANCHOR] }

const MEMOS = [
  {
    id: "m1",
    run_date: "2026-11-08",
    ai_job_id: "eGG43XP3Iw2R5VV2699n",
    rationale: "Dropping the new post; linking the two orphans instead.",
    agent_confidence: 4,
    outcome_status: "pending",
    outcome_metrics: null,
    dissents_from_brief: false,
    dissent_reason: null,
    signals_summary: {},
    actions: [
      { rank: 1, tool: "queue_internal_link_sweep", args: sweepArgs, executed: true, execution_target_id: "job-done" },
      {
        rank: 2,
        tool: "flag_for_human",
        args: {
          issue: "Which post targets 'beginner running training'?",
          context: "64 impressions, 0 clicks.",
          urgency: "medium",
        },
        executed: true,
        execution_target_id: "notif-1",
      },
    ],
  },
  {
    id: "m2",
    run_date: "2026-11-08",
    ai_job_id: "TTEeXpq3710MSmvB0F9p",
    rationale: "New post on beginner running training.",
    agent_confidence: 8,
    outcome_status: "pending",
    outcome_metrics: null,
    dissents_from_brief: false,
    dissent_reason: null,
    signals_summary: {},
    actions: [
      {
        rank: 1,
        tool: "queue_new_post",
        args: { keyword: "beginner running training", angle: "A strength coach's guide." },
        executed: true,
        execution_target_id: "cal-1",
      },
      {
        rank: 2,
        tool: "queue_internal_link_sweep",
        args: sweepArgs,
        executed: true,
        execution_target_id: "job-running",
      },
    ],
  },
]

const POSTS = {
  [TARGET]: { title: "Hamstring Injuries Are Skill Failures", slug: "hamstring" },
  [ANCHOR]: { title: "Change of Direction Speed Assessment", slug: "cod" },
}
const JOBS = {
  "job-done": { status: "completed", result: { insertions: 1 }, error: null },
  "job-running": { status: "processing", result: null, error: null },
}

/** Answers only for the ids passed in, like the real `.in("id", ids)`. */
function only<T>(table: Record<string, T>) {
  return async (ids: string[]) => Object.fromEntries(ids.filter((id) => id in table).map((id) => [id, table[id]]))
}

function setup({ draft = null as string | null, flag = { user_id: "viewer", is_read: false }, jobsDown = false } = {}) {
  vi.mocked(auth).mockResolvedValue({ user: { id: "viewer", role: "admin" } } as never)
  vi.mocked(listMemos).mockResolvedValue(MEMOS as never)
  vi.mocked(getBlogPostTitles).mockImplementation(only(POSTS))
  vi.mocked(getCalendarDraftRefs).mockImplementation(only({ "cal-1": draft }))
  vi.mocked(getNotificationReadStates).mockImplementation(only({ "notif-1": flag }))
  vi.mocked(getAiJobSnapshots).mockImplementation(
    jobsDown ? async () => Promise.reject(new Error("firestore down")) : (only(JOBS) as never),
  )
}

async function card(title: RegExp, nth = 0) {
  render(await Page())
  const heading = screen.getAllByText(title)[nth]
  return within(heading.closest("div.rounded-lg") as HTMLElement)
}

beforeEach(() => vi.clearAllMocks())

describe("SEO agent memos page", () => {
  it("names the linked posts and reports what each sweep job did", async () => {
    setup()
    const done = await card(/Linked your posts together/, 0)
    expect(
      done.getByText(/inside “Change of Direction Speed Assessment” that points to “Hamstring Injuries/),
    ).toBeTruthy()
    expect(done.getByText("Done: added 1 link")).toBeTruthy()
    expect(done.getByRole("link", { name: /Open “Hamstring/ }).getAttribute("href")).toBe(`/admin/blog/${TARGET}`)
    expect(screen.getByText("Working on it")).toBeTruthy()
    expect(screen.getByText("Agent is unsure (4/10)")).toBeTruthy()
    // Raw ids appear, but only inside the collapsed "Technical details" section.
    const raw = screen.getAllByText(/dd896e80/)
    expect(raw.every((el) => el.closest("details")?.textContent?.startsWith("Technical details"))).toBe(true)
  })

  it("offers 'Write the draft' for a topic with no draft yet", async () => {
    setup({ draft: null })
    const c = await card(/Suggested a new blog post/)
    expect(c.getByText("Waiting for you")).toBeTruthy()
    expect(c.getByRole("button", { name: "Write the draft" })).toBeTruthy()
  })

  it("links to the draft once it is written, and drops the write button", async () => {
    setup({ draft: "post-9" })
    const c = await card(/Suggested a new blog post/)
    expect(c.getByText("Draft written")).toBeTruthy()
    expect(c.getByRole("link", { name: /Open the draft/ }).getAttribute("href")).toBe("/admin/blog/post-9")
    expect(c.queryByRole("button", { name: "Write the draft" })).toBeNull()
  })

  it("gives 'Mark as handled' only to the person the question was sent to", async () => {
    setup()
    expect((await card(/Has a question for you/)).getByRole("button", { name: "Mark as handled" })).toBeTruthy()
  })

  it("tells anyone else who can mark it", async () => {
    setup({ flag: { user_id: "someone-else", is_read: false } })
    const c = await card(/Has a question for you/)
    expect(c.queryByRole("button", { name: "Mark as handled" })).toBeNull()
    expect(c.getByText(/Only they can mark it handled/)).toBeTruthy()
  })

  it("shows a handled question as handled, with no button", async () => {
    setup({ flag: { user_id: "viewer", is_read: true } })
    const c = await card(/Has a question for you/)
    expect(c.getByText("Handled")).toBeTruthy()
    expect(c.queryByRole("button", { name: "Mark as handled" })).toBeNull()
  })

  it("shows a sweep the agent refused as a repeat as skipped, not failed", async () => {
    setup()
    const memos = structuredClone(MEMOS)
    Object.assign(memos[1].actions[1], {
      executed: false,
      execution_target_id: null,
      rejection_reason: "repeat_sweep:job-done",
    })
    vi.mocked(listMemos).mockResolvedValue(memos as never)
    const c = await card(/Linked your posts together/, 1)
    expect(c.getByText("Skipped: done recently")).toBeTruthy()
    expect(c.queryByText("Not done")).toBeNull()
  })

  it("still renders when job statuses cannot be read", async () => {
    setup({ jobsDown: true })
    vi.spyOn(console, "error").mockImplementation(() => {})
    render(await Page())
    expect(screen.getAllByText("Started")).toHaveLength(2)
  })
})
