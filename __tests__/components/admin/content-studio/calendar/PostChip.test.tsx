// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { DndContext } from "@dnd-kit/core"
import { PostChip } from "@/components/admin/content-studio/calendar/PostChip"
import { postToChip, newsletterToChip, type CalendarChip } from "@/lib/content-studio/calendar-chips"

const chip: CalendarChip = postToChip(
  {
    id: "p1",
    platform: "instagram",
    content: "12345678901234567890123456789012345 — long caption preview text",
    media_url: null,
    post_type: "video",
    approval_status: "scheduled",
    scheduled_at: "2026-04-20T15:00:00Z",
    published_at: null,
    source_video_id: "v1",
    rejection_notes: null,
    platform_post_id: null,
    created_by: "u",
    created_at: "",
    updated_at: "",
  },
  "rotational-reboot.mp4",
)

function wrap(ui: React.ReactNode) {
  return <DndContext>{ui}</DndContext>
}

describe("<PostChip>", () => {
  it("renders platform icon + truncated caption", () => {
    render(wrap(<PostChip chip={chip} />))
    expect(screen.getByText(/12345678901234567890123456789/)).toBeInTheDocument()
  })

  it("hover shows the mini-card with full label + Open link", () => {
    render(wrap(<PostChip chip={chip} />))
    fireEvent.mouseEnter(screen.getByRole("button", { name: /scheduled/i }))
    expect(screen.getByRole("link", { name: /Open/ })).toHaveAttribute("href", "/admin/content/post/p1")
  })

  it("published chips are non-draggable (no pointer cursor)", () => {
    const published = { ...chip, status: "published" as const }
    const { container } = render(wrap(<PostChip chip={published as CalendarChip} />))
    expect(container.firstChild).not.toHaveClass(/cursor-grab/)
  })

  it("failed chips show a retry button on hover", () => {
    const failed = {
      ...chip,
      status: "failed" as const,
      rejection_notes: "oops",
    } as CalendarChip
    render(wrap(<PostChip chip={failed} />))
    fireEvent.mouseEnter(screen.getByRole("button", { name: /failed/i }))
    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument()
  })

  describe("a sent newsletter chip is locked — a regression guard for isLocked's drag gate", () => {
    // PostChip used to carry a LOCAL duplicate of isLocked, which was the
    // real gate on useDraggable's `disabled` flag; it now calls the shared
    // lib/content-studio/calendar-chips isLocked. Nothing previously
    // constructed a kind: "newsletter" / status: "sent" chip and asserted
    // PostChip's disabled output, so a reintroduced local duplicate (or a
    // newsletter case it forgot) would ship silently and let a coach drag an
    // already-sent email to a new date. dnd-kit only spreads
    // aria-roledescription="draggable" (and the rest of `attributes`) onto
    // the node when the chip is NOT locked, so that attribute's presence is
    // a direct, observable proxy for `disabled` here.
    const sentNewsletter: CalendarChip = newsletterToChip({
      id: "nl1",
      subject: "August round-up",
      preview_text: "",
      content: "x".repeat(50),
      status: "sent",
      scheduled_at: null,
      sent_at: "2026-04-20T09:00:00Z",
      sent_count: 120,
      failed_count: 0,
      source_blog_post_id: null,
      author_id: "a",
      created_at: "",
      updated_at: "",
      schedule_failed_reason: null,
    } as never)

    const scheduledNewsletter: CalendarChip = newsletterToChip({
      id: "nl2",
      subject: "September preview",
      preview_text: "",
      content: "x".repeat(50),
      status: "scheduled",
      scheduled_at: "2026-09-01T07:00:00Z",
      sent_at: null,
      sent_count: 0,
      failed_count: 0,
      source_blog_post_id: null,
      author_id: "a",
      created_at: "",
      updated_at: "",
      schedule_failed_reason: null,
    } as never)

    it("a sent newsletter chip is not draggable", () => {
      render(wrap(<PostChip chip={sentNewsletter} />))
      const node = screen.getByRole("button", { name: /^sent /i })
      expect(node).not.toHaveAttribute("aria-roledescription")
    })

    it("a scheduled (not yet sent) newsletter chip remains draggable, for contrast", () => {
      render(wrap(<PostChip chip={scheduledNewsletter} />))
      const node = screen.getByRole("button", { name: /^scheduled /i })
      expect(node).toHaveAttribute("aria-roledescription", "draggable")
    })
  })

  it("calendar entries (kind='entry') render with the title", () => {
    const entry: CalendarChip = {
      kind: "entry",
      id: "e1",
      label: "Draft blog",
      scheduledAt: new Date("2026-04-20T10:00:00Z"),
      platformOrType: "blog_post",
      status: "planned",
      raw: {
        id: "e1",
        entry_type: "blog_post",
        reference_id: null,
        title: "Draft blog",
        scheduled_for: "2026-04-20",
        scheduled_time: "10:00",
        status: "planned",
        metadata: {},
        created_at: "",
        updated_at: "",
      },
    }
    render(wrap(<PostChip chip={entry} />))
    expect(screen.getByText(/Draft blog/)).toBeInTheDocument()
  })
})
