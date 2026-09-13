// @vitest-environment jsdom
// Pasting a reference design into the builder chat (2026-09-14 spec §5.4).
//
// `prepareReferenceImage` is mocked because jsdom has no real 2D canvas
// context — its own arithmetic is tested directly in
// `__tests__/lib/funnels/reference-image.test.ts`. What is under test HERE is
// the composer's state machine: stage, show, replace, clear, and hand to
// `onSend`. Each assertion names the mutant it kills.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ChatPane } from "@/components/admin/funnels/builder/ChatPane"

const prepareReferenceImage = vi.fn()
vi.mock("@/lib/funnels/reference-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/funnels/reference-image")>()),
  prepareReferenceImage: (...args: unknown[]) => prepareReferenceImage(...args),
}))

const onSend = vi.fn()
const onChange = vi.fn()

const PREPARED = { mediaType: "image/jpeg", data: "QUJD", name: "brand-board.png", bytes: 120_000 }
const SECOND = { mediaType: "image/jpeg", data: "WFla", name: "competitor.png", bytes: 90_000 }

function mount(value = "match this look") {
  return render(
    <ChatPane
      messages={[]}
      maxMessageLength={2000}
      value={value}
      onChange={onChange}
      onSend={onSend}
      busy={false}
      currentRevision={1}
      funnelKind="funnel"
      funnelId="funnel-1"
    />,
  )
}

/** A paste carrying one image file, shaped the way a real clipboard is. */
function pasteImage(name = "brand-board.png") {
  const file = new File(["bytes"], name, { type: "image/png" })
  fireEvent.paste(screen.getByLabelText(/describe the change/i), {
    clipboardData: { files: [file], items: [{ kind: "file", type: "image/png", getAsFile: () => file }] },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  prepareReferenceImage.mockResolvedValue(PREPARED)
})

describe("attaching a reference image", () => {
  it("a pasted image is staged and shown by name", async () => {
    mount()
    pasteImage()
    // The mutant: preparing the image and never rendering it. The owner would
    // have no way to see what they attached or take it back before spending a
    // turn on it.
    expect(await screen.findByText(/brand-board\.png/)).toBeTruthy()
  })

  it("sending hands the prepared image to onSend alongside the text", async () => {
    mount("match this look")
    pasteImage()
    await screen.findByText(/brand-board\.png/)
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }))
    // Asserts WHICH value, not that a second argument exists.
    expect(onSend).toHaveBeenCalledWith("match this look", PREPARED)
  })

  it("sending with NO image passes text only", async () => {
    mount("make it shorter")
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }))
    expect(onSend).toHaveBeenCalledWith("make it shorter", undefined)
  })

  it("the chip clears after send", async () => {
    mount()
    pasteImage()
    await screen.findByText(/brand-board\.png/)
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }))
    // An image is attached to a TURN, not to the session. Leaving it pinned
    // would silently re-send it on every later turn, spending vision tokens
    // the owner did not ask for.
    await waitFor(() => expect(screen.queryByText(/brand-board\.png/)).toBeNull())
  })

  it("a second attachment REPLACES the first rather than accumulating", async () => {
    mount()
    pasteImage("brand-board.png")
    await screen.findByText(/brand-board\.png/)
    prepareReferenceImage.mockResolvedValue(SECOND)
    pasteImage("competitor.png")
    await screen.findByText(/competitor\.png/)
    // The route takes ONE image. A UI that let a second accumulate would
    // silently drop one.
    expect(screen.queryByText(/brand-board\.png/)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }))
    expect(onSend).toHaveBeenCalledWith("match this look", SECOND)
  })

  it("the remove control takes the image back off the turn", async () => {
    mount()
    pasteImage()
    await screen.findByText(/brand-board\.png/)
    fireEvent.click(screen.getByRole("button", { name: /remove reference image/i }))
    expect(screen.queryByText(/brand-board\.png/)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }))
    expect(onSend).toHaveBeenCalledWith("match this look", undefined)
  })

  it("a rejected file is explained and nothing is staged", async () => {
    mount()
    const file = new File(["x"], "sheet.pdf", { type: "application/pdf" })
    fireEvent.paste(screen.getByLabelText(/describe the change/i), {
      clipboardData: { files: [file], items: [{ kind: "file", type: "application/pdf", getAsFile: () => file }] },
    })
    expect(await screen.findByText(/JPEG|PNG/i)).toBeTruthy()
    // A degrading helper turning a rejection into a silent no-op is the trap
    // this repo has already paid for in the recorder library.
    expect(prepareReferenceImage).not.toHaveBeenCalled()
  })

  it("a plain text paste is left completely alone", async () => {
    mount()
    fireEvent.paste(screen.getByLabelText(/describe the change/i), {
      clipboardData: { files: [], items: [{ kind: "string", type: "text/plain" }] },
    })
    // The mutant: a handler that calls preventDefault unconditionally, which
    // would break ordinary copy-paste into the composer.
    expect(prepareReferenceImage).not.toHaveBeenCalled()
  })

  it("offers a file picker as well as paste", () => {
    mount()
    // Paste does not exist on a tablet and is not discoverable on a desktop.
    expect(screen.getByLabelText(/attach a reference image/i)).toBeTruthy()
  })
})
