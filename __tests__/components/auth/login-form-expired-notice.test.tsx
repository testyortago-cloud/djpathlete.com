// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { LoginForm } from "@/app/(auth)/login/LoginForm"

let searchParams = new URLSearchParams()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => searchParams,
}))

vi.mock("next-auth/react", () => ({
  signIn: vi.fn(),
}))

beforeEach(() => {
  searchParams = new URLSearchParams()
})

describe("LoginForm expired-session notice", () => {
  it("shows the notice when arriving with expired=1", () => {
    searchParams = new URLSearchParams("expired=1&callbackUrl=%2Fclient%2Fdashboard")
    render(<LoginForm />)
    expect(screen.getByRole("status")).toHaveTextContent(/your session ended/i)
  })

  it("does not show the notice on a normal visit", () => {
    render(<LoginForm />)
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })
})
