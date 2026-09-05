// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))

import { DetailBreadcrumb } from "@/components/admin/content-studio/detail/DetailBreadcrumb"

describe("<DetailBreadcrumb>", () => {
  it("shows the Content Studio root, the parent tab, and the current page", () => {
    render(<DetailBreadcrumb backHref="/admin/content?tab=videos" backLabel="Videos" current="My Clip" />)
    expect(screen.getByRole("link", { name: "Content Studio" })).toHaveAttribute("href", "/admin/content")
    expect(screen.getByRole("link", { name: "Videos" })).toHaveAttribute("href", "/admin/content?tab=videos")
    expect(screen.getByText("My Clip")).toBeInTheDocument()
  })

  it("omits the redundant Pipeline hop (Pipeline IS /admin/content)", () => {
    render(<DetailBreadcrumb backHref="/admin/content" backLabel="Pipeline" current="My Clip" />)
    expect(screen.getByRole("link", { name: "Content Studio" })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Pipeline" })).toBeNull()
    expect(screen.getByText("My Clip")).toBeInTheDocument()
  })
})
