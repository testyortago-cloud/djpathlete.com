// @vitest-environment jsdom
// __tests__/components/admin/seo-panel.test.tsx
//
// The door that did not exist. Four columns have been writable since migration
// 00202 and are NULL on every production row because nothing rendered an
// input for them — so the thing under test is not really the fields, it is
// whether the owner can tell what the page will actually serve.
//
// `fireEvent`, not `user-event`: that package is not a dependency of this repo
// (same deviation, same reason, as funnel-builder.test.tsx).

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { SeoPanel, type SeoPanelValue } from "@/components/admin/funnels/builder/SeoPanel"

const EMPTY: SeoPanelValue = {
  seo_title: null,
  seo_description: null,
  og_image_url: null,
  noindex: false,
}

function renderPanel(
  value: Partial<SeoPanelValue> = {},
  overrides: Partial<React.ComponentProps<typeof SeoPanel>> = {},
) {
  const onSave = vi.fn().mockResolvedValue(undefined)
  render(
    <SeoPanel
      funnelName="Athlete Performance Insight"
      funnelSlug="athlete-quiz"
      stepName="Start"
      stepSlug="start"
      isEntry
      funnelIsPublished
      value={{ ...EMPTY, ...value }}
      onSave={onSave}
      busy={false}
      {...overrides}
    />,
  )
  return { onSave }
}

describe("SeoPanel — the preview", () => {
  it("shows the FALLBACK title, not an empty box, when seo_title is unset", () => {
    renderPanel()
    // This is the whole reason the panel runs the shared resolver instead of
    // echoing its own inputs. On an empty row the two differ, and the empty
    // rows are every row in production.
    expect(screen.getByText("Athlete Performance Insight | DJP Athlete")).toBeInTheDocument()
    // And it must NOT be the step's internal name — the bug being fixed.
    expect(screen.queryByText(/^Start \| DJP Athlete$/)).not.toBeInTheDocument()
  })

  it("shows the entry step's canonical URL without the step slug", () => {
    renderPanel()
    expect(screen.getByText("www.darrenjpaul.com/go/athlete-quiz")).toBeInTheDocument()
  })

  it("says plainly that no description is set rather than showing a blank", () => {
    renderPanel()
    expect(screen.getByText(/Google will pick a sentence from the page itself/)).toBeInTheDocument()
  })

  it("updates the preview as the owner types", () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText("Page title"), {
      target: { value: "Rotational Power Quiz" },
    })
    expect(screen.getByText("Rotational Power Quiz | DJP Athlete")).toBeInTheDocument()
  })

  it("warns when the page is hidden from Google", () => {
    renderPanel({ noindex: true })
    expect(screen.getByText(/will not appear in search results/)).toBeInTheDocument()
  })
})

describe("SeoPanel — the counters", () => {
  it("reports the RENDERED title length, brand suffix included", () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText("Page title"), { target: { value: "A".repeat(40) } })
    // 40 typed + " | DJP Athlete" (14) = 54. A counter that showed only 40
    // is how someone writes a 47-character title and ships a 61-character one.
    expect(screen.getByText("Shows as 54 characters")).toBeInTheDocument()
    expect(screen.getByText(/^40\/47/)).toBeInTheDocument()
  })

  it("flags a title over the convention's budget without blocking it", () => {
    renderPanel()
    const input = screen.getByLabelText("Page title")
    fireEvent.change(input, { target: { value: "B".repeat(55) } })
    expect(screen.getByText(/^55\/47 · long$/)).toBeInTheDocument()
    // Still saveable — the budget is advice, not the API's cap.
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled()
  })

  it("flags a description that is too short to be useful", () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Too short." } })
    expect(screen.getByText(/^10\/160 · short$/)).toBeInTheDocument()
  })
})

describe("SeoPanel — saving", () => {
  beforeEach(() => vi.clearAllMocks())

  it("is disabled until something changes", () => {
    renderPanel({ seo_title: "Already set" })
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })

  it("sends all four fields, with blanks as null", async () => {
    const { onSave } = renderPanel()
    fireEvent.change(screen.getByLabelText("Page title"), {
      target: { value: "  Find Your Power Gap  " },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    // Asserts the WHOLE payload, not that a call happened. A panel that sent
    // `{seo_title}` alone would clear nothing and look identical from here.
    expect(onSave).toHaveBeenCalledWith({
      seo_title: "Find Your Power Gap",
      seo_description: null,
      og_image_url: null,
      noindex: false,
    })
  })

  it("sends noindex when the toggle is flipped", async () => {
    const { onSave } = renderPanel()
    fireEvent.click(screen.getByRole("switch", { name: /Hide from Google/ }))
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0]).toMatchObject({ noindex: true })
  })

  it("refuses a relative image path IN THE PANEL, with a reason", async () => {
    // `og_image_url` is `z.string().url()` on the API and the route answers a
    // bare "Invalid request" naming no field. A path starting with "/" is the
    // obvious thing to type and every other image field in this app takes one,
    // so an unexplained 400 here is a dead end.
    const { onSave } = renderPanel()
    fireEvent.change(screen.getByLabelText("Sharing picture"), {
      target: { value: "/images/hero.jpg" },
    })
    expect(screen.getByText(/Needs the full web address/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it("accepts a full https image URL", () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText("Sharing picture"), {
      target: { value: "https://cdn.example.com/quiz.jpg" },
    })
    expect(screen.queryByText(/Needs the full web address/)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled()
  })

  it("tells the owner an SEO edit needs no re-publish on a live funnel", () => {
    renderPanel({}, { funnelIsPublished: true })
    // Everything else in this builder needs a publish to reach the public, so
    // without this sentence a saved-but-apparently-unchanged live page reads
    // as a failed save.
    expect(screen.getByText(/updates the live page straight away/)).toBeInTheDocument()
  })

  it("says the opposite on a draft funnel", () => {
    renderPanel({}, { funnelIsPublished: false })
    expect(screen.getByText(/goes public when you publish/)).toBeInTheDocument()
  })
})
