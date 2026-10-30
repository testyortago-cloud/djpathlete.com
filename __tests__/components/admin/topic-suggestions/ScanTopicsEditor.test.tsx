// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast: toastMock }))

import { ScanTopicsEditor } from "@/components/admin/topic-suggestions/ScanTopicsEditor"

const topics = [
  { id: "t1", name: "Agility", keywords: ["deceleration", "cutting"], active: true },
  { id: "t2", name: "Energy system conditioning", keywords: [], active: true },
]

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

describe("ScanTopicsEditor", () => {
  it("switching a topic off saves it, keeps it, and crosses it out", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
    render(<ScanTopicsEditor initialTopics={topics} />)
    expect(screen.getByText("2 searches")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("switch", { name: 'Search "Energy system conditioning" in the weekly scan' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/admin/topic-suggestions/topics")
    expect(JSON.parse(init.body).topics).toEqual([topics[0], { ...topics[1], active: false }])
    expect(screen.getByText("Energy system conditioning")).toHaveClass("line-through")
    expect(screen.getByText("Off this week")).toBeInTheDocument()
    expect(screen.getByText("1 on · 2 of 20 searches")).toBeInTheDocument()
  })

  it("puts the switch back when the save is refused", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "Switch at least one topic on" }) })
    render(<ScanTopicsEditor initialTopics={topics} />)
    fireEvent.click(screen.getByRole("switch", { name: 'Search "Agility" in the weekly scan' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText("Agility")).not.toHaveClass("line-through"))
    expect(screen.getByRole("switch", { name: 'Search "Agility" in the weekly scan' })).toHaveAttribute(
      "aria-checked",
      "true",
    )
  })

  it("Undo puts back only the removed topic, into the list as it is now", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
    render(<ScanTopicsEditor initialTopics={topics} />)
    fireEvent.click(screen.getByRole("button", { name: 'Remove "Agility"' }))
    await waitFor(() => expect(toastMock).toHaveBeenCalled())
    fireEvent.click(screen.getByRole("switch", { name: 'Search "Energy system conditioning" in the weekly scan' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole("switch")).not.toBeDisabled())

    const undo = toastMock.mock.calls[0][1].action.onClick
    undo()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).topics).toEqual([topics[0], { ...topics[1], active: false }])
  })

  it("refuses a second topic with the same name", async () => {
    render(<ScanTopicsEditor initialTopics={topics} />)
    fireEvent.change(screen.getByRole("textbox", { name: "New topic" }), { target: { value: " agility " } })
    fireEvent.click(screen.getByRole("button", { name: "Add topic" }))
    expect(toastMock.error).toHaveBeenCalledWith("There is already a topic with that name")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("adds a topic with keywords", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
    render(<ScanTopicsEditor initialTopics={topics} />)
    fireEvent.change(screen.getByRole("textbox", { name: "New topic" }), { target: { value: "Strength" } })
    fireEvent.change(screen.getByRole("textbox", { name: "Keywords for the new topic, comma-separated" }), {
      target: { value: "isometrics, eccentric, isometrics" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Add topic" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body).topics
    expect(sent[2]).toMatchObject({ name: "Strength", keywords: ["isometrics", "eccentric"], active: true })
  })
})
