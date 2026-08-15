// "Go back to here" — the transcript's undo.
//
// The machinery (`revertToRevision`, a `source:'revert'` head turn) shipped
// with the builder and was only ever wired to corruption recovery, which was
// fine while every change to a page was a deliberate AI turn. Click-to-edit
// changed that: a double-click and a keystroke now commits, so stepping back
// one has to exist.
//
// What these pin is the DERIVED verdict, because that is where it can go wrong:
// a turn is restorable only if it left a document behind AND is no longer the
// head. Offering it on the head is a button that burns a revision and changes
// nothing, which teaches an owner the undo is broken.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { ChatPane } from "@/components/admin/funnels/builder/ChatPane"
import type { BuilderMessage } from "@/components/admin/funnels/builder/types"

const onRestore = vi.fn()
const onSend = vi.fn()
const onChange = vi.fn()

function mount(messages: BuilderMessage[], currentRevision: number) {
  return render(
    <ChatPane
      messages={messages}
      maxMessageLength={2000}
      value=""
      onChange={onChange}
      onSend={onSend}
      busy={false}
      currentRevision={currentRevision}
      onRestore={onRestore}
    />,
  )
}

const aiTurn = (revision: number, producedDoc = true): BuilderMessage => ({
  id: `b${revision}`,
  role: "builder",
  text: `Built revision ${revision}`,
  revision,
  producedDoc,
})

const clickEdit = (revision: number): BuilderMessage => ({
  id: `o${revision}`,
  role: "owner",
  text: "Hero — headline",
  revision,
  producedDoc: true,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("go back to here", () => {
  it("offers it on an earlier turn that produced a document", () => {
    mount([aiTurn(4), aiTurn(5)], 5)
    const buttons = screen.getAllByRole("button", { name: /go back to here/i })
    expect(buttons).toHaveLength(1)
  })

  it("restores to that turn's revision", () => {
    mount([aiTurn(4), aiTurn(5)], 5)
    fireEvent.click(screen.getByRole("button", { name: /go back to here/i }))
    expect(onRestore).toHaveBeenCalledWith(4)
  })

  it("never offers it on the head", () => {
    // MUTANT KILLED: `<=` instead of `<`. Restoring to where you already are
    // appends a turn, advances the revision, and changes nothing on the page.
    mount([aiTurn(5)], 5)
    expect(screen.queryByRole("button", { name: /go back to here/i })).not.toBeInTheDocument()
  })

  it("never offers it on a turn that wrote no document", () => {
    // A user prompt, or an AI turn that was blocked or failed. There is no
    // document behind it to go back to.
    mount([aiTurn(4, false), aiTurn(5)], 5)
    expect(screen.queryByRole("button", { name: /go back to here/i })).not.toBeInTheDocument()
  })

  it("offers it on a CLICK EDIT, not just an AI turn", () => {
    // An inspector turn is `role: "user"` and carries a document — the owner
    // wrote it, not the model. It is the case this whole affordance exists for.
    mount([clickEdit(6), aiTurn(7)], 7)
    const card = screen.getByText("Hero — headline").closest("div")!
    expect(within(card).getByRole("button", { name: /go back to here/i })).toBeInTheDocument()
  })

  it("says that nothing is deleted, because nothing is", () => {
    // The restore APPENDS a turn carrying the older document, so every later
    // turn survives and can itself be gone back to. That is what makes it safe
    // to press without a confirmation dialog — and the owner should not have to
    // risk their page to find that out.
    mount([aiTurn(4), aiTurn(5)], 5)
    expect(screen.getByText(/nothing is deleted/i)).toBeInTheDocument()
  })

  it("disables it while a turn is in flight", () => {
    render(
      <ChatPane
        messages={[aiTurn(4), aiTurn(5)]}
        maxMessageLength={2000}
        value=""
        onChange={onChange}
        onSend={onSend}
        busy
        currentRevision={5}
        onRestore={onRestore}
      />,
    )
    expect(screen.getByRole("button", { name: /go back to here/i })).toBeDisabled()
  })

  it("shows nothing when the caller supplies no restore handler", () => {
    render(
      <ChatPane
        messages={[aiTurn(4), aiTurn(5)]}
        maxMessageLength={2000}
        value=""
        onChange={onChange}
        onSend={onSend}
        busy={false}
        currentRevision={5}
      />,
    )
    expect(screen.queryByRole("button", { name: /go back to here/i })).not.toBeInTheDocument()
  })

  it("offers one per restorable turn as history grows", () => {
    mount([aiTurn(3), clickEdit(4), clickEdit(5), aiTurn(6)], 6)
    expect(screen.getAllByRole("button", { name: /go back to here/i })).toHaveLength(3)
  })
})
