import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { VoiceRecorder } from "@/components/shared/VoiceRecorder"

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
})
