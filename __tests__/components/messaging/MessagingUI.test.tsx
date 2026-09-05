// @vitest-environment jsdom
import type React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import type { MessageWithExtras } from "@/types/database"

// emoji-picker-react ships the whole emoji dataset and touches browser APIs
// jsdom does not implement. The contract worth testing is which props we pass
// it -- above all emojiStyle, since the library default fetches PNG sprites
// from a CDN our CSP blocks.
const pickerProps: Record<string, unknown>[] = []
vi.mock("emoji-picker-react", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    pickerProps.push(props)
    return (
      <button
        type="button"
        data-testid="emoji-option"
        onClick={() => (props.onEmojiClick as (d: { emoji: string }) => void)({ emoji: "🎉" })}
      >
        🎉
      </button>
    )
  },
  EmojiStyle: { NATIVE: "native", APPLE: "apple", GOOGLE: "google", TWITTER: "twitter", FACEBOOK: "facebook" },
}))

// next/dynamic would defer the mocked picker past the assertions.
vi.mock("next/dynamic", () => ({
  __esModule: true,
  default: (loader: () => Promise<{ default: unknown }>) => {
    let Loaded: unknown = null
    void loader().then((mod) => {
      Loaded = mod.default
    })
    return (props: Record<string, unknown>) => {
      const Component = Loaded as ((p: Record<string, unknown>) => React.ReactElement) | null
      return Component ? Component(props) : null
    }
  },
}))

const messagingMock = vi.hoisted(() => ({ useMessaging: vi.fn() }))
vi.mock("@/components/messaging/MessagingProvider", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, useMessaging: messagingMock.useMessaging }
})

import { MessagingDock } from "@/components/messaging/MessagingDock"
import { MessageBubble } from "@/components/messaging/MessageBubble"
import { MessageComposer } from "@/components/messaging/MessageComposer"
import { EMOJI_STYLE } from "@/components/messaging/EmojiPickerPopover"

const CONV = "11111111-1111-4111-8111-111111111111"

function message(over: Partial<MessageWithExtras> = {}): MessageWithExtras {
  return {
    id: "m1",
    conversation_id: CONV,
    sender_user_id: "admin-1",
    sender_role: "admin",
    body: "Nice squat",
    attachment_count: 0,
    created_at: "2024-05-01T10:00:00Z",
    email_notified_at: null,
    attachments: [],
    reactions: [],
    ...over,
  }
}

function attachment(over = {}) {
  return {
    id: "att-1",
    message_id: "m1",
    kind: "image" as const,
    storage_path: `messaging/${CONV}/up-1/photo.png`,
    mime_type: "image/png",
    byte_size: 1024,
    width: 800,
    height: 600,
    duration_seconds: null,
    original_filename: "photo.png",
    created_at: "2024-05-01T10:00:00Z",
    ...over,
  }
}

function contextValue(over: Record<string, unknown> = {}) {
  return {
    viewerRole: "admin",
    viewerId: "admin-1",
    conversations: [],
    totalUnread: 0,
    activeConversationId: null,
    messages: [],
    loadingThread: false,
    connectionState: "live",
    typingFromOther: false,
    isOtherOnline: false,
    openConversation: vi.fn(),
    closeConversation: vi.fn(),
    sendMessage: vi.fn(async () => ({ ok: true })),
    toggleReaction: vi.fn(async () => {}),
    broadcastTyping: vi.fn(),
    refreshConversations: vi.fn(async () => {}),
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  pickerProps.length = 0
  messagingMock.useMessaging.mockReturnValue(contextValue())
})

describe("EmojiPickerPopover", () => {
  it("uses the NATIVE emoji style, so the picker makes no CDN request", () => {
    // The library default is APPLE, which loads sprites from cdn.jsdelivr.net.
    // A CSP that blocks it shows blank tiles, not an error -- so assert it.
    expect(EMOJI_STYLE).toBe("native")
  })
})

describe("MessagingDock", () => {
  it("shows the unread count on the collapsed pill", () => {
    messagingMock.useMessaging.mockReturnValue(contextValue({ totalUnread: 3 }))
    render(<MessagingDock />)
    expect(screen.getByLabelText("Messages, 3 unread")).toBeInTheDocument()
    expect(screen.getByText("3")).toBeInTheDocument()
  })

  it("hides the badge at zero", () => {
    render(<MessagingDock />)
    expect(screen.getByLabelText("Messages")).toBeInTheDocument()
    expect(screen.queryByText("0")).not.toBeInTheDocument()
  })

  it("renders no panel content until it is opened", () => {
    render(<MessagingDock />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText("Messages"))
    expect(screen.getByRole("dialog", { name: "Messages" })).toBeInTheDocument()
  })

  it("opens the conversation it was asked for", () => {
    const openConversation = vi.fn()
    messagingMock.useMessaging.mockReturnValue(
      contextValue({
        openConversation,
        totalUnread: 2,
        conversations: [
          {
            id: CONV,
            client_user_id: "c1",
            client: { id: "c1", first_name: "Sam", last_name: "Rivera", email: "s@example.com", avatar_url: null },
            unread_count: 2,
            last_message_at: "2024-05-01T10:00:00Z",
            last_message_preview: "See you Tuesday",
            last_message_sender_role: "client",
            client_last_read_at: null,
            admin_last_read_at: null,
            created_at: "2024-01-01T00:00:00Z",
          },
        ],
      }),
    )

    render(<MessagingDock />)
    fireEvent.click(screen.getByLabelText("Messages, 2 unread"))
    fireEvent.click(screen.getByText("Sam Rivera"))
    expect(openConversation).toHaveBeenCalledWith(CONV)
  })
})

describe("MessageBubble", () => {
  const noop = vi.fn()

  it("renders an image attachment INLINE, not as a link to click through", () => {
    render(
      <MessageBubble
        message={message({ attachment_count: 1, attachments: [attachment()], body: null })}
        viewerId="admin-1"
        mine
        onToggleReaction={noop}
      />,
    )

    const img = screen.getByTestId("message-image")
    expect(img.tagName).toBe("IMG")
    // The src is the app route, never a raw signed GCS URL -- those expire and
    // a thread is read for weeks.
    expect(img).toHaveAttribute("src", "/api/messaging/attachments/att-1?redirect=1")
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })

  it("renders a video attachment as a video element", () => {
    render(
      <MessageBubble
        message={message({
          attachment_count: 1,
          attachments: [attachment({ kind: "video", mime_type: "video/mp4", id: "att-2" })],
          body: null,
        })}
        viewerId="admin-1"
        mine
        onToggleReaction={noop}
      />,
    )
    const video = screen.getByTestId("message-video")
    expect(video.tagName).toBe("VIDEO")
    expect(video).toHaveAttribute("preload", "metadata")
  })

  it("groups reactions into one chip per emoji and marks your own", () => {
    render(
      <MessageBubble
        message={message({
          reactions: [
            { id: "r1", message_id: "m1", user_id: "admin-1", emoji: "👍", created_at: "2024-05-01T10:00:00Z" },
            { id: "r2", message_id: "m1", user_id: "client-1", emoji: "👍", created_at: "2024-05-01T10:00:00Z" },
            { id: "r3", message_id: "m1", user_id: "client-1", emoji: "🎉", created_at: "2024-05-01T10:00:00Z" },
          ],
        })}
        viewerId="admin-1"
        mine
        onToggleReaction={noop}
      />,
    )

    const thumbs = screen.getByLabelText("👍 2")
    expect(thumbs).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByLabelText("🎉 1")).toHaveAttribute("aria-pressed", "false")
  })

  it("toggles a reaction when its chip is clicked", () => {
    const onToggleReaction = vi.fn()
    render(
      <MessageBubble
        message={message({
          reactions: [
            { id: "r1", message_id: "m1", user_id: "client-1", emoji: "👍", created_at: "2024-05-01T10:00:00Z" },
          ],
        })}
        viewerId="admin-1"
        mine
        onToggleReaction={onToggleReaction}
      />,
    )
    fireEvent.click(screen.getByLabelText("👍 1"))
    expect(onToggleReaction).toHaveBeenCalledWith("m1", "👍")
  })
})

describe("MessageComposer", () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ uploads: [] }), { status: 200 })) as never
  })

  it("rejects an oversize file locally, without issuing any request", async () => {
    const onSend = vi.fn(async () => ({ ok: true }))
    render(<MessageComposer conversationId={CONV} onSend={onSend} />)

    const tooBig = new File(["x"], "huge.mp4", { type: "video/mp4" })
    Object.defineProperty(tooBig, "size", { value: 26 * 1024 * 1024 })

    fireEvent.change(screen.getByTestId("file-input"), { target: { files: [tooBig] } })

    await waitFor(() => {
      // A 25 MB check that costs a round trip is the worst version of itself.
      expect(global.fetch).not.toHaveBeenCalled()
    })
    global.fetch = originalFetch
  })

  it("will not send an empty message", () => {
    const onSend = vi.fn(async () => ({ ok: true }))
    render(<MessageComposer conversationId={CONV} onSend={onSend} />)

    const send = screen.getByRole("button", { name: /send/i })
    expect(send).toBeDisabled()
    fireEvent.click(send)
    expect(onSend).not.toHaveBeenCalled()
    global.fetch = originalFetch
  })

  it("sends the typed body on Ctrl+Enter", async () => {
    const onSend = vi.fn(async () => ({ ok: true }))
    render(<MessageComposer conversationId={CONV} onSend={onSend} />)

    const textarea = screen.getByLabelText("Message")
    fireEvent.change(textarea, { target: { value: "Good session today" } })
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true })

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ body: "Good session today" }))
    })
    global.fetch = originalFetch
  })

  it("does NOT send on a bare Enter — that would fire half-typed messages", () => {
    const onSend = vi.fn(async () => ({ ok: true }))
    render(<MessageComposer conversationId={CONV} onSend={onSend} />)

    const textarea = screen.getByLabelText("Message")
    fireEvent.change(textarea, { target: { value: "still typing" } })
    fireEvent.keyDown(textarea, { key: "Enter" })

    expect(onSend).not.toHaveBeenCalled()
    global.fetch = originalFetch
  })

  it("reports typing as the user types", () => {
    const onTyping = vi.fn()
    render(<MessageComposer conversationId={CONV} onSend={vi.fn(async () => ({ ok: true }))} onTyping={onTyping} />)
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "h" } })
    expect(onTyping).toHaveBeenCalled()
    global.fetch = originalFetch
  })
})
