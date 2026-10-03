// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TestimonialCarousel } from "@/components/public/TestimonialCarousel"
import { renderToString } from "react-dom/server"
import { hydrateRoot } from "react-dom/client"

const preferences = vi.hoisted(() => ({ reducedMotion: false }))
vi.mock("framer-motion", () => ({
  useReducedMotion: () => preferences.reducedMotion,
  motion: {
    div: ({
      children,
      initial,
      animate,
      exit,
      transition,
      ...props
    }: React.PropsWithChildren<Record<string, unknown>>) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => children,
}))

const testimonials = [
  {
    name: "Lewis Cook",
    title: "Professional football player",
    quote: "He helped me get back on the pitch.",
    avatarUrl: "/lewis.jpg",
    rating: 5,
  },
  {
    name: "Tina Pisnik",
    title: "Professional pickleball player",
    quote: "I can train from anywhere.",
    avatarUrl: null,
    rating: 5,
  },
]

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  preferences.reducedMotion = false
})

describe("TestimonialCarousel", () => {
  it("hydrates without replacing the server markup when reduced motion is enabled", async () => {
    const container = document.createElement("div")
    container.innerHTML = renderToString(<TestimonialCarousel testimonials={testimonials} />)
    document.body.appendChild(container)
    preferences.reducedMotion = true
    const onRecoverableError = vi.fn()
    let root: ReturnType<typeof hydrateRoot> | undefined
    await act(async () => {
      root = hydrateRoot(container, <TestimonialCarousel testimonials={testimonials} />, { onRecoverableError })
    })
    try {
      expect(onRecoverableError).not.toHaveBeenCalled()
    } finally {
      act(() => root?.unmount())
      container.remove()
    }
  })

  it("opens with an available athlete photo while keeping the original athlete order", () => {
    render(<TestimonialCarousel testimonials={[testimonials[1], testimonials[0]]} />)
    expect(screen.getByText(/He helped me get back/)).toBeVisible()
    expect(screen.getByRole("group", { name: "2 of 2" })).toBeInTheDocument()
  })

  it("advances automatically and stops while a reader hovers", () => {
    vi.useFakeTimers()
    render(<TestimonialCarousel testimonials={testimonials} interval={1000} />)
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByText(/I can train from anywhere/)).toBeVisible()
    fireEvent.mouseEnter(screen.getByRole("region", { name: "Athlete testimonials" }))
    act(() => vi.advanceTimersByTime(3000))
    expect(screen.getByText(/I can train from anywhere/)).toBeVisible()
    fireEvent.mouseLeave(screen.getByRole("region", { name: "Athlete testimonials" }))
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByText(/He helped me get back/)).toBeVisible()
  })

  it("lets readers move between athletes and keeps the selected control identifiable", () => {
    render(<TestimonialCarousel testimonials={testimonials} />)
    expect(screen.getByRole("button", { name: "Read Lewis Cook's testimonial" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    fireEvent.click(screen.getByRole("button", { name: "Next testimonial" }))
    expect(screen.getByText(/I can train from anywhere/)).toBeVisible()
    expect(screen.getByRole("button", { name: "Read Tina Pisnik's testimonial" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    fireEvent.click(screen.getByRole("button", { name: "Previous testimonial" }))
    expect(screen.getByText(/He helped me get back/)).toBeVisible()
  })

  it("keeps a readable athlete identity when a photo fails", () => {
    render(<TestimonialCarousel testimonials={[testimonials[0]]} />)
    fireEvent.error(screen.getByRole("img", { name: "Lewis Cook" }))
    expect(screen.queryByRole("img", { name: "Lewis Cook" })).not.toBeInTheDocument()
    expect(screen.getByText("LC")).toBeVisible()
    expect(screen.getByText("Lewis Cook")).toBeVisible()
    expect(screen.queryByRole("button", { name: "Next testimonial" })).not.toBeInTheDocument()
  })

  it("stops automatic changes while keyboard readers focus the carousel", () => {
    vi.useFakeTimers()
    render(<TestimonialCarousel testimonials={testimonials} interval={1000} />)
    fireEvent.focus(screen.getByRole("button", { name: "Next testimonial" }))
    act(() => vi.advanceTimersByTime(3000))
    expect(screen.getByText(/He helped me get back/)).toBeVisible()
  })

  it("honors a reader's pause choice and reduced motion preference", () => {
    vi.useFakeTimers()
    render(<TestimonialCarousel testimonials={testimonials} interval={1000} />)
    fireEvent.click(screen.getByRole("button", { name: "Pause testimonials" }))
    act(() => vi.advanceTimersByTime(3000))
    expect(screen.getByText(/He helped me get back/)).toBeVisible()
    cleanup()
    preferences.reducedMotion = true
    render(<TestimonialCarousel testimonials={testimonials} interval={1000} />)
    act(() => vi.advanceTimersByTime(3000))
    expect(screen.getByText(/He helped me get back/)).toBeVisible()
  })

  it("does not render an empty carousel", () => {
    const { container } = render(<TestimonialCarousel testimonials={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
