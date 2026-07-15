import { describe, it, expect } from "vitest"
import { buildLeadMailtoLink, buildTelLink } from "@/lib/leads/build-mailto-link"

describe("buildLeadMailtoLink", () => {
  it("encodes spaces as %20, not +", () => {
    const link = buildLeadMailtoLink({
      email: "lead@example.com",
      subject: "Re: Hi there",
      body: "Thanks for reaching out",
    })
    expect(link).toContain("subject=Re%3A%20Hi%20there")
    expect(link).toContain("body=Thanks%20for%20reaching%20out")
    expect(link).not.toContain("+")
  })

  it("starts with mailto: and the raw address", () => {
    const link = buildLeadMailtoLink({ email: "lead@example.com", subject: "s", body: "b" })
    expect(link.startsWith("mailto:lead@example.com?")).toBe(true)
  })

  it("truncates long bodies with an ellipsis", () => {
    const longBody = "a".repeat(700)
    const link = buildLeadMailtoLink({ email: "lead@example.com", subject: "s", body: longBody })
    const bodyParam = decodeURIComponent(link.split("body=")[1])
    expect(bodyParam.length).toBeLessThanOrEqual(601)
    expect(bodyParam.endsWith("…")).toBe(true)
  })

  it("leaves short bodies untouched", () => {
    const link = buildLeadMailtoLink({ email: "lead@example.com", subject: "s", body: "short" })
    const bodyParam = decodeURIComponent(link.split("body=")[1])
    expect(bodyParam).toBe("short")
  })
})

describe("buildTelLink", () => {
  it("strips formatting characters, keeps digits and a leading +", () => {
    expect(buildTelLink("(786) 831-1665")).toBe("tel:7868311665")
    expect(buildTelLink("+1 786-831-1665")).toBe("tel:+17868311665")
  })
})
