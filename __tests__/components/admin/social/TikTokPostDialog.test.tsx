// @vitest-environment jsdom
// The "Post to TikTok" screen. TikTok's reviewers judge it against their
// content-sharing guidelines: the account is shown, nothing is pre-chosen,
// and the coach's choices are exactly what gets saved and sent.
import type { ComponentProps } from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { TikTokPostDialog } from "@/components/admin/social/TikTokPostDialog"
import type { SocialPost } from "@/types/database"
import type { TikTokCreatorInfo } from "@/lib/social/tiktok-post-rules"
import type { TikTokPostSettings } from "@/lib/validators/tiktok-post-settings"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const MUSIC_URL = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
const BC_URL = "https://www.tiktok.com/legal/page/global/bc-policy/en"
const SUCCESS = "Sent to TikTok. It can take a few minutes to appear on your profile."
const DRAFT_SUCCESS = "Sent to your TikTok drafts. Open TikTok and check your inbox to finish and post it."
const DRAFT_NOTE = "Drafts open in the TikTok app, where you add the caption and choose who can see it."

function makePost(overrides: Partial<SocialPost> = {}): SocialPost {
  return {
    id: "post-1",
    platform: "tiktok",
    content: "Hip mobility in 30 seconds.",
    media_url: null,
    post_type: "video",
    approval_status: "approved",
    scheduled_at: null,
    published_at: null,
    source_video_id: "video-1",
    rejection_notes: null,
    platform_post_id: null,
    created_by: "user-1",
    created_at: "2026-11-17T09:00:00Z",
    updated_at: "2026-11-17T09:00:00Z",
    ...overrides,
  }
}

function makeCreator(overrides: Partial<TikTokCreatorInfo> = {}): TikTokCreatorInfo {
  return {
    avatarUrl: "https://example.test/avatar.jpg",
    username: "coach",
    nickname: "Coach",
    privacyLevelOptions: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"],
    commentDisabled: false,
    duetDisabled: false,
    stitchDisabled: false,
    maxVideoPostDurationSec: 600,
    ...overrides,
  }
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

type Handler = (init?: RequestInit) => Response | Promise<Response>
let fetchMock: ReturnType<typeof vi.fn>

// One fake server for the five routes the dialog talks to. Unknown calls throw,
// so a request the dialog should not make fails the test loudly.
function serve(over: Partial<Record<"GET" | "PUT" | "PATCH" | "PUBLISH" | "DRAFT", Handler>> = {}) {
  const handlers: Record<"GET" | "PUT" | "PATCH" | "PUBLISH" | "DRAFT", Handler> = {
    GET: () => json(200, { creator: makeCreator(), previewUrl: "https://cdn.test/video.mp4", saved: null }),
    PUT: (init) => json(200, { tiktok_settings: JSON.parse(String(init?.body)).settings }),
    PATCH: (init) =>
      json(200, {
        id: "post-1",
        content: JSON.parse(String(init?.body)).caption_text,
        approval_status: "approved",
        version: 2,
      }),
    PUBLISH: () => json(200, { approval_status: "scheduled", scheduled_at: "2026-11-17T10:00:00Z" }),
    DRAFT: () => json(200, { publish_id: "pub_1" }),
    ...over,
  }
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET"
    if (url === "/api/admin/social/posts/post-1/tiktok" && method === "GET") return handlers.GET(init)
    if (url === "/api/admin/social/posts/post-1/tiktok" && method === "PUT") return handlers.PUT(init)
    if (url === "/api/admin/social/posts/post-1" && method === "PATCH") return handlers.PATCH(init)
    if (url === "/api/admin/social/posts/post-1/publish-now" && method === "POST") return handlers.PUBLISH(init)
    if (url === "/api/admin/social/posts/post-1/tiktok/draft" && method === "POST") return handlers.DRAFT(init)
    throw new Error(`unexpected request ${method} ${url}`)
  })
  global.fetch = fetchMock as unknown as typeof fetch
}

function calls(method: string, suffix: string) {
  return fetchMock.mock.calls.filter(
    ([url, init]) => ((init as RequestInit | undefined)?.method ?? "GET") === method && String(url).endsWith(suffix),
  )
}

function renderDialog(props: Partial<ComponentProps<typeof TikTokPostDialog>> = {}) {
  const handlers = { onOpenChange: vi.fn(), onQueued: vi.fn(), onReadyToSchedule: vi.fn() }
  const utils = render(<TikTokPostDialog post={makePost()} intent="now" open {...handlers} {...props} />)
  return { ...handlers, ...utils }
}

async function privacySelect() {
  return (await screen.findByRole("combobox", { name: "Who can view this video" })) as HTMLSelectElement
}

// jsdom never loads media; stand in for the browser reading the file's length.
function loadVideo(seconds: number) {
  const video = document.querySelector("video")
  if (!video) throw new Error("no <video> rendered")
  Object.defineProperty(video, "duration", { value: seconds, configurable: true })
  fireEvent.loadedMetadata(video)
}

function choosePrivacy(value: string) {
  fireEvent.change(screen.getByRole("combobox", { name: "Who can view this video" }), { target: { value } })
}

const postButton = () => screen.getByRole("button", { name: "Post to TikTok" })
const draftButton = () => screen.getByRole("button", { name: "Send to TikTok drafts" })
const declaration = () => screen.getByText(/By posting, you agree to TikTok/)

beforeEach(() => {
  vi.clearAllMocks()
  serve()
})

describe("<TikTokPostDialog> — what TikTok requires the screen to show", () => {
  it("shows the creator's nickname and username", async () => {
    renderDialog()
    expect(await screen.findByText("Coach")).toBeInTheDocument()
    expect(screen.getByText("@coach")).toBeInTheDocument()
    expect(document.querySelector("img")).toHaveAttribute("src", "https://example.test/avatar.jpg")
    expect(calls("GET", "/tiktok")).toHaveLength(1)
  })

  it("previews the exact file that will be posted", async () => {
    renderDialog()
    await privacySelect()
    const video = document.querySelector("video")
    expect(video).toHaveAttribute("src", "https://cdn.test/video.mp4")
    expect(video).toHaveAttribute("controls")
  })

  it("starts with no privacy chosen", async () => {
    renderDialog()
    const select = await privacySelect()
    loadVideo(30)
    expect(select.value).toBe("")
    const placeholder = screen.getByRole("option", { name: "Select who can view" }) as HTMLOptionElement
    expect(placeholder.value).toBe("")
    expect(placeholder).toBeDisabled()
    expect(postButton()).toBeDisabled()
    expect(screen.getByText("Choose who can view this video.")).toBeInTheDocument()
  })

  it("labels the four privacy options verbatim", async () => {
    renderDialog()
    const select = await privacySelect()
    const labels = Array.from(select.options)
      .filter((o) => o.value !== "")
      .map((o) => o.textContent)
    expect(labels).toEqual(["Everyone", "Friends", "Followers", "Only me"])
  })

  it("offers only the privacy levels the account allows", async () => {
    serve({
      GET: () =>
        json(200, {
          creator: makeCreator({ privacyLevelOptions: ["FOLLOWER_OF_CREATOR", "SELF_ONLY"] }),
          previewUrl: "https://cdn.test/video.mp4",
          saved: null,
        }),
    })
    renderDialog()
    const select = await privacySelect()
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["", "FOLLOWER_OF_CREATOR", "SELF_ONLY"])
  })

  it("starts with Comment, Duet and Stitch unchecked", async () => {
    renderDialog()
    await privacySelect()
    for (const name of ["Comment", "Duet", "Stitch"]) {
      const box = screen.getByRole("checkbox", { name })
      expect(box).not.toBeChecked()
      expect(box).toBeEnabled()
    }
  })

  it("disables an interaction the creator turned off", async () => {
    serve({
      GET: () =>
        json(200, {
          creator: makeCreator({ duetDisabled: true }),
          previewUrl: "https://cdn.test/video.mp4",
          saved: null,
        }),
    })
    renderDialog()
    await privacySelect()
    expect(screen.getByRole("checkbox", { name: "Duet" })).toBeDisabled()
    expect(screen.getByRole("checkbox", { name: "Comment" })).toBeEnabled()
    expect(screen.getByRole("checkbox", { name: "Stitch" })).toBeEnabled()
  })

  it("starts with disclosure off", async () => {
    renderDialog()
    await privacySelect()
    expect(screen.getByRole("switch", { name: "Disclose video content" })).toHaveAttribute("aria-checked", "false")
    expect(screen.queryByRole("checkbox", { name: "Your brand" })).not.toBeInTheDocument()
    expect(screen.queryByRole("checkbox", { name: "Branded content" })).not.toBeInTheDocument()
  })

  it("blocks Post until a brand box is ticked when disclosing", async () => {
    renderDialog()
    await privacySelect()
    loadVideo(30)
    choosePrivacy("PUBLIC_TO_EVERYONE")
    expect(postButton()).toBeEnabled()

    fireEvent.click(screen.getByRole("switch", { name: "Disclose video content" }))
    expect(postButton()).toBeDisabled()
    expect(
      screen.getByText("You need to indicate if your content promotes yourself, a third party, or both."),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole("checkbox", { name: "Your brand" }))
    expect(postButton()).toBeEnabled()
    expect(screen.getByText('Your photo/video will be labeled as "Promotional content"')).toBeInTheDocument()

    fireEvent.click(screen.getByRole("checkbox", { name: "Branded content" }))
    expect(screen.getByText('Your photo/video will be labeled as "Paid partnership"')).toBeInTheDocument()
  })

  it("makes Branded content and Only me exclusive", async () => {
    renderDialog()
    await privacySelect()
    loadVideo(30)
    fireEvent.click(screen.getByRole("switch", { name: "Disclose video content" }))

    fireEvent.click(screen.getByRole("checkbox", { name: "Branded content" }))
    expect(screen.getByRole("option", { name: "Only me" })).toBeDisabled()
    expect(screen.getByRole("option", { name: "Everyone" })).toBeEnabled()
    expect(screen.getByText("Branded content can't be private.")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("checkbox", { name: "Branded content" }))
    expect(screen.getByRole("option", { name: "Only me" })).toBeEnabled()
    choosePrivacy("SELF_ONLY")
    expect(screen.getByRole("checkbox", { name: "Branded content" })).toBeDisabled()
    expect(screen.getByRole("checkbox", { name: "Your brand" })).toBeEnabled()
    expect(screen.getByText("Branded content can't be private.")).toBeInTheDocument()
  })

  it("switches the declaration when Branded content is ticked", async () => {
    renderDialog()
    await privacySelect()
    expect(declaration().textContent).toBe("By posting, you agree to TikTok's Music Usage Confirmation.")
    expect(screen.getByRole("link", { name: "Music Usage Confirmation" })).toHaveAttribute("href", MUSIC_URL)
    expect(screen.queryByRole("link", { name: "Branded Content Policy" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("switch", { name: "Disclose video content" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Branded content" }))
    expect(declaration().textContent).toBe(
      "By posting, you agree to TikTok's Branded Content Policy and Music Usage Confirmation.",
    )
    const bc = screen.getByRole("link", { name: "Branded Content Policy" })
    expect(bc).toHaveAttribute("href", BC_URL)
    expect(bc).toHaveAttribute("target", "_blank")
    expect(bc).toHaveAttribute("rel", "noopener noreferrer")
    expect(screen.getByRole("link", { name: "Music Usage Confirmation" })).toHaveAttribute("target", "_blank")
  })
})

describe("<TikTokPostDialog> — when the account can't post", () => {
  it("shows the refusal and no form when the route answers 409", async () => {
    serve({
      GET: () => json(409, { error: "This TikTok account has reached today's posting limit. Try again tomorrow." }),
    })
    const { onOpenChange } = renderDialog()
    expect(
      await screen.findByText("This TikTok account has reached today's posting limit. Try again tomorrow."),
    ).toBeInTheDocument()
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Post to TikTok" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument()
    expect(document.querySelector("video")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("offers Retry when the route fails, and Retry loads the form", async () => {
    const replies = [
      () => new Response("<html><body>Internal Server Error</body></html>", { status: 500 }),
      () => json(502, { error: "Couldn't reach TikTok. Try again." }),
      () => json(200, { creator: makeCreator(), previewUrl: "https://cdn.test/video.mp4", saved: null }),
    ]
    serve({ GET: () => replies.shift()!() })
    renderDialog()

    expect(await screen.findByText("Our server hit an error. Please try again in a moment.")).toBeInTheDocument()
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))

    expect(await screen.findByText("Couldn't reach TikTok. Try again.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))

    await privacySelect()
    expect(calls("GET", "/tiktok")).toHaveLength(3)
  })
})

describe("<TikTokPostDialog> — the video", () => {
  it("blocks a video longer than the account allows", async () => {
    renderDialog()
    await privacySelect()
    choosePrivacy("PUBLIC_TO_EVERYONE")
    loadVideo(601)
    expect(
      screen.getByText("This video is 601 seconds long. TikTok allows up to 600 seconds for this account."),
    ).toBeInTheDocument()
    expect(postButton()).toBeDisabled()
  })

  it("treats a length the browser can't read as still loading", async () => {
    renderDialog()
    await privacySelect()
    choosePrivacy("PUBLIC_TO_EVERYONE")
    expect(screen.getByText("Loading the video…")).toBeInTheDocument()
    loadVideo(Number.POSITIVE_INFINITY)
    expect(screen.getByText("Loading the video…")).toBeInTheDocument()
    expect(postButton()).toBeDisabled()
  })

  it("keeps Post blocked when the video can't load", async () => {
    renderDialog()
    await privacySelect()
    choosePrivacy("PUBLIC_TO_EVERYONE")
    fireEvent.error(document.querySelector("video")!)
    expect(screen.getByText("Couldn't load this video.")).toBeInTheDocument()
    expect(postButton()).toBeDisabled()
  })
})

describe("<TikTokPostDialog> — the caption", () => {
  it("caps the caption at 2200 characters", async () => {
    renderDialog()
    await privacySelect()
    const caption = screen.getByRole("textbox", { name: "Caption" })
    expect(caption).toHaveValue("Hip mobility in 30 seconds.")
    expect(caption).toHaveAttribute("maxLength", "2200")
    expect(screen.getByText("27/2200")).toBeInTheDocument()
    fireEvent.change(caption, { target: { value: "x".repeat(2200) } })
    expect(screen.getByText("2200/2200")).toBeInTheDocument()
  })

  it("blocks a saved caption already over the limit instead of cutting it at publish", async () => {
    renderDialog({ post: makePost({ content: "y".repeat(2300) }) })
    await privacySelect()
    loadVideo(30)
    choosePrivacy("PUBLIC_TO_EVERYONE")
    expect(screen.getByText("2300/2200")).toBeInTheDocument()
    expect(screen.getByText("Shorten the caption to 2200 characters or fewer.")).toBeInTheDocument()
    expect(postButton()).toBeDisabled()
  })
})

describe("<TikTokPostDialog> — saving and sending", () => {
  it("saves once and queues once on a double click", async () => {
    const { onQueued, onOpenChange } = renderDialog()
    await privacySelect()
    loadVideo(30)
    choosePrivacy("PUBLIC_TO_EVERYONE")
    fireEvent.click(screen.getByRole("checkbox", { name: "Comment" }))

    fireEvent.click(postButton())
    fireEvent.click(postButton())

    await waitFor(() => expect(onQueued).toHaveBeenCalledTimes(1))
    expect(calls("PUT", "/tiktok")).toHaveLength(1)
    expect(calls("POST", "/publish-now")).toHaveLength(1)
    expect(calls("PATCH", "/post-1")).toHaveLength(0)

    const sent = JSON.parse(String((calls("PUT", "/tiktok")[0][1] as RequestInit).body)).settings
    expect(sent).toEqual({
      privacy_level: "PUBLIC_TO_EVERYONE",
      allow_comment: true,
      allow_duet: false,
      allow_stitch: false,
      disclose: false,
      your_brand: false,
      branded_content: false,
    })
    expect(onQueued).toHaveBeenCalledWith(
      expect.objectContaining({ id: "post-1", approval_status: "scheduled", tiktok_settings: sent }),
    )
    expect(toast.success).toHaveBeenCalledWith(SUCCESS)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("ignores Escape while a request is in flight", async () => {
    let releasePut!: () => void
    serve({
      PUT: (init) =>
        new Promise<Response>((resolve) => {
          releasePut = () => resolve(json(200, { tiktok_settings: JSON.parse(String(init?.body)).settings }))
        }),
    })
    const { onOpenChange, onQueued } = renderDialog()
    await privacySelect()
    loadVideo(30)
    choosePrivacy("PUBLIC_TO_EVERYONE")

    // Presence control: with nothing in flight, Escape does ask to close.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    onOpenChange.mockClear()

    fireEvent.click(postButton())
    await waitFor(() => expect(calls("PUT", "/tiktok")).toHaveLength(1))
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
    expect(onOpenChange).not.toHaveBeenCalled()

    releasePut()
    await waitFor(() => expect(onQueued).toHaveBeenCalledTimes(1))
    // The only close is the one the finished send makes itself.
    expect(onOpenChange).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("turning disclosure off clears the brand boxes, so nothing hidden is sent", async () => {
    const { onQueued } = renderDialog()
    await privacySelect()
    loadVideo(30)
    choosePrivacy("PUBLIC_TO_EVERYONE")
    fireEvent.click(screen.getByRole("switch", { name: "Disclose video content" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Your brand" }))
    fireEvent.click(screen.getByRole("switch", { name: "Disclose video content" }))
    fireEvent.click(postButton())

    await waitFor(() => expect(onQueued).toHaveBeenCalledTimes(1))
    const sent = JSON.parse(String((calls("PUT", "/tiktok")[0][1] as RequestInit).body)).settings
    expect(sent).toMatchObject({ disclose: false, your_brand: false, branded_content: false })
  })

  it("PATCHes the caption only when it changed", async () => {
    const { onQueued } = renderDialog()
    await privacySelect()
    loadVideo(30)
    choosePrivacy("FOLLOWER_OF_CREATOR")
    fireEvent.change(screen.getByRole("textbox", { name: "Caption" }), {
      target: { value: "Hips first, then the rest." },
    })
    fireEvent.click(postButton())

    await waitFor(() => expect(onQueued).toHaveBeenCalledTimes(1))
    const patches = calls("PATCH", "/post-1")
    expect(patches).toHaveLength(1)
    expect(JSON.parse(String((patches[0][1] as RequestInit).body))).toEqual({
      caption_text: "Hips first, then the rest.",
    })
    // The caption is saved before the settings, and both before anything is queued.
    expect(
      fetchMock.mock.calls.map(([url, init]) => `${(init as RequestInit | undefined)?.method ?? "GET"} ${url}`),
    ).toEqual([
      "GET /api/admin/social/posts/post-1/tiktok",
      "PATCH /api/admin/social/posts/post-1",
      "PUT /api/admin/social/posts/post-1/tiktok",
      "POST /api/admin/social/posts/post-1/publish-now",
    ])
    expect(onQueued).toHaveBeenCalledWith(expect.objectContaining({ content: "Hips first, then the rest." }))
  })

  // Review finding: the PATCH lands, the PUT fails, and the parent never hears
  // the caption changed. Reopening must show the caption the server now holds
  // (the one TikTok would get), not the parent's stale copy.
  it("after the caption saved but the settings failed, reopening shows and sends the saved caption", async () => {
    let puts = 0
    serve({
      PUT: (init) =>
        ++puts === 1
          ? json(500, { error: "Couldn't save your TikTok choices." })
          : json(200, { tiktok_settings: JSON.parse(String(init?.body)).settings }),
    })
    const { rerender, onOpenChange, onQueued, onReadyToSchedule } = renderDialog()
    const props = { post: makePost(), intent: "now" as const, onOpenChange, onQueued, onReadyToSchedule }
    await privacySelect()
    loadVideo(30)
    choosePrivacy("PUBLIC_TO_EVERYONE")
    fireEvent.change(screen.getByRole("textbox", { name: "Caption" }), {
      target: { value: "Hips first, then the rest." },
    })
    fireEvent.click(postButton())
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't save your TikTok choices."))
    expect(calls("PATCH", "/post-1")).toHaveLength(1)

    rerender(<TikTokPostDialog {...props} open={false} />)
    rerender(<TikTokPostDialog {...props} open />)
    await privacySelect()
    expect(screen.getByRole("textbox", { name: "Caption" })).toHaveValue("Hips first, then the rest.")

    loadVideo(30)
    choosePrivacy("PUBLIC_TO_EVERYONE")
    fireEvent.click(postButton())
    await waitFor(() => expect(onQueued).toHaveBeenCalledTimes(1))
    expect(calls("PATCH", "/post-1")).toHaveLength(1)
    expect(calls("PUT", "/tiktok")).toHaveLength(2)
    expect(onQueued).toHaveBeenCalledWith(expect.objectContaining({ content: "Hips first, then the rest." }))
  })

  it("for schedule, saves settings and calls onReadyToSchedule without publish-now", async () => {
    const { onQueued, onReadyToSchedule } = renderDialog({ intent: "schedule" })
    await privacySelect()
    loadVideo(30)
    choosePrivacy("MUTUAL_FOLLOW_FRIENDS")
    expect(screen.queryByRole("button", { name: "Post to TikTok" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Continue to schedule" }))

    await waitFor(() => expect(onReadyToSchedule).toHaveBeenCalledTimes(1))
    expect(calls("PUT", "/tiktok")).toHaveLength(1)
    expect(calls("POST", "/publish-now")).toHaveLength(0)
    expect(onQueued).not.toHaveBeenCalled()
    expect(onReadyToSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "post-1",
        tiktok_settings: expect.objectContaining({ privacy_level: "MUTUAL_FOLLOW_FRIENDS" }),
      }),
    )
    expect(toast.success).not.toHaveBeenCalledWith(SUCCESS)
  })

  it("toasts the error and stays open when a request fails", async () => {
    serve({ PUBLISH: () => json(409, { error: "Connect TikTok on the Connections page first." }) })
    const { onQueued, onOpenChange } = renderDialog()
    await privacySelect()
    loadVideo(30)
    choosePrivacy("PUBLIC_TO_EVERYONE")
    fireEvent.click(postButton())

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Connect TikTok on the Connections page first."))
    expect(onQueued).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    await waitFor(() => expect(postButton()).toBeEnabled())
  })
})

describe("<TikTokPostDialog> — reopening", () => {
  const saved: TikTokPostSettings = {
    privacy_level: "FOLLOWER_OF_CREATOR",
    allow_comment: true,
    allow_duet: false,
    allow_stitch: true,
    disclose: true,
    your_brand: true,
    branded_content: false,
  }

  it("fetches fresh creator info on every open and restores this post's own saved choices", async () => {
    serve({ GET: () => json(200, { creator: makeCreator(), previewUrl: "https://cdn.test/video.mp4", saved }) })
    const { rerender, onOpenChange, onQueued, onReadyToSchedule } = renderDialog()
    const props = { post: makePost(), intent: "now" as const, onOpenChange, onQueued, onReadyToSchedule }
    expect((await privacySelect()).value).toBe("FOLLOWER_OF_CREATOR")

    rerender(<TikTokPostDialog {...props} open={false} />)
    rerender(<TikTokPostDialog {...props} open />)
    const select = await privacySelect()
    expect(calls("GET", "/tiktok")).toHaveLength(2)

    expect(select.value).toBe("FOLLOWER_OF_CREATOR")
    expect(screen.getByRole("checkbox", { name: "Comment" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "Duet" })).not.toBeChecked()
    expect(screen.getByRole("checkbox", { name: "Stitch" })).toBeChecked()
    expect(screen.getByRole("switch", { name: "Disclose video content" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("checkbox", { name: "Your brand" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "Branded content" })).not.toBeChecked()
  })

  it("opens blank for a post that was never through the dialog", async () => {
    renderDialog()
    const select = await privacySelect()
    expect(select.value).toBe("")
    for (const name of ["Comment", "Duet", "Stitch"]) {
      expect(screen.getByRole("checkbox", { name })).not.toBeChecked()
    }
    expect(screen.getByRole("switch", { name: "Disclose video content" })).toHaveAttribute("aria-checked", "false")
  })
})

describe("<TikTokPostDialog> — Send to TikTok drafts", () => {
  it("is offered when posting now, with a note about finishing in the TikTok app", async () => {
    renderDialog()
    await privacySelect()
    expect(draftButton()).toBeInTheDocument()
    expect(screen.getByText(DRAFT_NOTE)).toBeInTheDocument()
  })

  it("is not offered when scheduling", async () => {
    renderDialog({ intent: "schedule" })
    await privacySelect()
    expect(screen.queryByRole("button", { name: "Send to TikTok drafts" })).not.toBeInTheDocument()
    expect(screen.queryByText(DRAFT_NOTE)).not.toBeInTheDocument()
  })

  it("is not offered while the account is refused or failed to load", async () => {
    serve({ GET: () => json(409, { error: "This TikTok account has reached today's posting limit." }) })
    renderDialog()
    await screen.findByText("This TikTok account has reached today's posting limit.")
    expect(screen.queryByRole("button", { name: "Send to TikTok drafts" })).not.toBeInTheDocument()
  })

  it("waits for the video length, but needs no privacy choice", async () => {
    renderDialog()
    const select = await privacySelect()
    expect(select.value).toBe("")
    expect(draftButton()).toBeDisabled()
    loadVideo(30)
    expect(select.value).toBe("")
    expect(postButton()).toBeDisabled()
    expect(draftButton()).toBeEnabled()
  })

  it("is blocked for a video longer than the account allows, or one that cannot load", async () => {
    renderDialog()
    await privacySelect()
    loadVideo(601)
    expect(draftButton()).toBeDisabled()
    // Presence control: a video inside the limit unblocks it.
    loadVideo(600)
    expect(draftButton()).toBeEnabled()
    fireEvent.error(document.querySelector("video")!)
    expect(draftButton()).toBeDisabled()
  })

  it("sends one request, toasts the plain message and closes without queuing anything", async () => {
    const { onOpenChange, onQueued, onReadyToSchedule } = renderDialog()
    await privacySelect()
    loadVideo(30)
    fireEvent.click(draftButton())

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(calls("POST", "/tiktok/draft")).toHaveLength(1)
    expect(toast.success).toHaveBeenCalledWith(DRAFT_SUCCESS)
    expect(onQueued).not.toHaveBeenCalled()
    expect(onReadyToSchedule).not.toHaveBeenCalled()
    // A draft saves no settings, no caption and does not publish.
    expect(calls("PUT", "/tiktok")).toHaveLength(0)
    expect(calls("PATCH", "/post-1")).toHaveLength(0)
    expect(calls("POST", "/publish-now")).toHaveLength(0)
  })

  it("sends once on a double click", async () => {
    const { onOpenChange } = renderDialog()
    await privacySelect()
    loadVideo(30)
    fireEvent.click(draftButton())
    fireEvent.click(draftButton())

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(calls("POST", "/tiktok/draft")).toHaveLength(1)
  })

  it("shows the error and stays open when the send fails", async () => {
    serve({ DRAFT: () => json(502, { error: "TikTok draft init failed (403): scope_not_authorized" }) })
    const { onOpenChange, onQueued } = renderDialog()
    await privacySelect()
    loadVideo(30)
    fireEvent.click(draftButton())

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("TikTok draft init failed (403): scope_not_authorized"))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(onQueued).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    await waitFor(() => expect(draftButton()).toBeEnabled())
  })

  it("is disabled while the primary send is in flight", async () => {
    let releasePut!: () => void
    serve({
      PUT: (init) =>
        new Promise<Response>((resolve) => {
          releasePut = () => resolve(json(200, { tiktok_settings: JSON.parse(String(init?.body)).settings }))
        }),
    })
    const { onQueued } = renderDialog()
    await privacySelect()
    loadVideo(30)
    choosePrivacy("PUBLIC_TO_EVERYONE")
    expect(draftButton()).toBeEnabled()

    fireEvent.click(postButton())
    await waitFor(() => expect(calls("PUT", "/tiktok")).toHaveLength(1))
    expect(draftButton()).toBeDisabled()
    // Only the clicked button shows it is working.
    expect(postButton().querySelector(".animate-spin")).not.toBeNull()
    expect(draftButton().querySelector(".animate-spin")).toBeNull()
    fireEvent.click(draftButton())
    expect(calls("POST", "/tiktok/draft")).toHaveLength(0)

    releasePut()
    await waitFor(() => expect(onQueued).toHaveBeenCalledTimes(1))
  })

  it("disables Post to TikTok while a draft is being sent", async () => {
    let releaseDraft!: () => void
    serve({
      DRAFT: () =>
        new Promise<Response>((resolve) => {
          releaseDraft = () => resolve(json(200, { publish_id: "pub_1" }))
        }),
    })
    const { onOpenChange } = renderDialog()
    await privacySelect()
    loadVideo(30)
    choosePrivacy("PUBLIC_TO_EVERYONE")
    fireEvent.click(draftButton())
    await waitFor(() => expect(calls("POST", "/tiktok/draft")).toHaveLength(1))
    expect(postButton()).toBeDisabled()
    // The draft is not a public post: only the draft button shows it is working.
    expect(draftButton().querySelector(".animate-spin")).not.toBeNull()
    expect(postButton().querySelector(".animate-spin")).toBeNull()
    // Escape mid-request is ignored, as for the primary send.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
    expect(onOpenChange).not.toHaveBeenCalled()

    releaseDraft()
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})

describe("<TikTokPostDialog> — footer layout and accessibility", () => {
  it("lets the footer buttons wrap on a narrow screen", async () => {
    renderDialog()
    await privacySelect()
    expect(draftButton().parentElement).toHaveClass("flex-wrap")
  })

  it("points a blocked draft button at the reason shown under the footer", async () => {
    renderDialog()
    await privacySelect()
    loadVideo(601)
    expect(draftButton()).toHaveAttribute("aria-describedby", "tiktok-post-blocker")
    expect(document.getElementById("tiktok-post-blocker")).toHaveTextContent(/601 seconds/)
    loadVideo(30)
    choosePrivacy("PUBLIC_TO_EVERYONE")
    expect(draftButton()).not.toHaveAttribute("aria-describedby")
  })
})
