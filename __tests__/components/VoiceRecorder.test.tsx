// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { VoiceRecorder, micErrorMessage } from "@/components/shared/VoiceRecorder"
import { toast } from "sonner"

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    dismiss: vi.fn(),
  },
}))

class FakeMediaRecorder {
  static isTypeSupported = vi.fn(() => true)
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  state: "inactive" | "recording" = "inactive"
  start() {
    this.state = "recording"
  }
  stop() {
    this.state = "inactive"
    this.ondataavailable?.({ data: new Blob(["x"], { type: "audio/webm" }) })
    this.onstop?.()
  }
}

const fakeStream = {
  getTracks: () => [{ stop: vi.fn() }],
} as unknown as MediaStream

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder)
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => fakeStream) },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("VoiceRecorder", () => {
  it("renders the mic button when MediaRecorder is supported", () => {
    render(<VoiceRecorder userId="u-1" onSend={vi.fn()} />)
    expect(screen.getByRole("button", { name: /record/i })).toBeInTheDocument()
  })

  it("renders nothing when MediaRecorder is missing", () => {
    vi.stubGlobal("MediaRecorder", undefined)
    const { container } = render(<VoiceRecorder userId="u-1" onSend={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("transitions idle → recording on click", async () => {
    render(<VoiceRecorder userId="u-1" onSend={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /record/i }))
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument()
    })
  })

  it("transitions to stopped (preview controls visible) after stop", async () => {
    render(<VoiceRecorder userId="u-1" onSend={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /record/i }))
    await waitFor(() => screen.getByRole("button", { name: /stop/i }))
    fireEvent.click(screen.getByRole("button", { name: /stop/i }))
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument()
    })
  })

  it("returns to idle after delete", async () => {
    render(<VoiceRecorder userId="u-1" onSend={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /record/i }))
    await waitFor(() => screen.getByRole("button", { name: /stop/i }))
    fireEvent.click(screen.getByRole("button", { name: /stop/i }))
    await waitFor(() => screen.getByRole("button", { name: /delete/i }))
    fireEvent.click(screen.getByRole("button", { name: /delete/i }))
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /record/i })).toBeInTheDocument()
    })
  })

  it("notifies parent of state changes via onStateChange (idle → recording → stopped → idle)", async () => {
    const onStateChange = vi.fn()
    render(<VoiceRecorder userId="u-1" onSend={vi.fn()} onStateChange={onStateChange} />)

    // Initial mount fires with "idle".
    await waitFor(() => expect(onStateChange).toHaveBeenCalledWith("idle"))

    fireEvent.click(screen.getByRole("button", { name: /record/i }))
    await waitFor(() => expect(onStateChange).toHaveBeenCalledWith("recording"))

    fireEvent.click(screen.getByRole("button", { name: /stop/i }))
    await waitFor(() => expect(onStateChange).toHaveBeenCalledWith("stopped"))

    fireEvent.click(screen.getByRole("button", { name: /delete/i }))
    await waitFor(() => {
      const calls = onStateChange.mock.calls.map((c) => c[0])
      // last call should be "idle" after deletion
      expect(calls[calls.length - 1]).toBe("idle")
    })
  })
})

describe("micErrorMessage", () => {
  it("returns a permission-specific message for NotAllowedError", () => {
    const msg = micErrorMessage(new DOMException("denied", "NotAllowedError"))
    expect(msg).toMatch(/blocked|lock icon|Site settings/i)
  })

  it("returns an in-use message for NotReadableError", () => {
    const msg = micErrorMessage(new DOMException("busy", "NotReadableError"))
    expect(msg).toMatch(/in use by another app/i)
  })

  it("returns a no-mic message for NotFoundError", () => {
    const msg = micErrorMessage(new DOMException("none", "NotFoundError"))
    expect(msg).toMatch(/no microphone/i)
  })

  it("returns null for AbortError so we don't toast on user-dismissed prompts", () => {
    expect(micErrorMessage(new DOMException("aborted", "AbortError"))).toBeNull()
  })

  it("returns a fallback for unknown errors", () => {
    expect(micErrorMessage(new Error("weird"))).toMatch(/couldn't access/i)
  })
})

describe("VoiceRecorder error handling", () => {
  function failGumWith(name: string) {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          throw new DOMException("x", name)
        }),
      },
    })
  }

  it("toasts the permission-specific message on NotAllowedError, with the stable mic toast id", async () => {
    failGumWith("NotAllowedError")
    render(<VoiceRecorder userId="u-1" onSend={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /record/i }))
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/blocked|lock icon|Site settings/i),
        expect.objectContaining({ id: "voice-recorder-mic-error" }),
      )
    })
  })

  it("does not toast when the user dismisses the prompt (AbortError)", async () => {
    failGumWith("AbortError")
    render(<VoiceRecorder userId="u-1" onSend={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /record/i }))
    await new Promise((r) => setTimeout(r, 10))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("dismisses the stale mic toast when permission flips to granted via the lock icon", async () => {
    let onChange: (() => void) | null = null
    const status = {
      state: "denied" as PermissionState,
      addEventListener: (event: string, h: () => void) => {
        if (event === "change") onChange = h
      },
      removeEventListener: vi.fn(),
    }
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: vi.fn(async () => status) },
    })

    render(<VoiceRecorder userId="u-1" onSend={vi.fn()} />)

    // Let the permissions.query promise resolve so the listener attaches.
    await waitFor(() => expect(onChange).not.toBeNull())

    // User flips permission to granted via the lock icon.
    status.state = "granted"
    onChange!()

    await waitFor(() => {
      expect(toast.dismiss).toHaveBeenCalledWith("voice-recorder-mic-error")
    })
  })
})
