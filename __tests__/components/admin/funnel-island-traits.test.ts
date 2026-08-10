import { describe, it, expect } from "vitest"
import { ISLAND_NAMES, ISLANDS, parseIslandProps, type IslandName } from "@/lib/funnels/islands"
import { ISLAND_TRAITS } from "@/components/admin/funnels/island-traits"
import { buildIslandProps, readIslandProps } from "@/components/admin/funnels/island-props"

describe("island traits cover their island's settings", () => {
  // The regression that motivated this file: `form` shipped a successMode
  // default with no trait to change it, which made the Redirect URL field
  // decorative — successMode could never leave "message".
  it.each(ISLAND_NAMES)("every default prop of %s is editable", (name) => {
    const traitNames = new Set(ISLAND_TRAITS[name].map((t) => t.name))
    for (const prop of Object.keys(ISLANDS[name].defaultProps)) {
      expect(traitNames, `${name}.${prop} has a default but no trait to edit it`).toContain(prop)
    }
  })

  // A fully-configured example per island. Zod strips keys it does not know, so
  // if a trait edits a prop the schema never heard of, that key vanishes here.
  const CONFIGURED: Record<IslandName, Record<string, unknown>> = {
    form: {
      formKey: "optin",
      fields: [{ name: "email", label: "Email", type: "email" }],
      submitLabel: "Get the guide",
      successMode: "message",
      successMessage: "You're in.",
      redirectUrl: "/go/thanks",
      consentText: "We'll email you the guide.",
    },
    checkout: {
      productKind: "program",
      productId: "11111111-1111-4111-8111-111111111111",
      label: "Buy now",
    },
    event: {
      eventId: "22222222-2222-4222-8222-222222222222",
      showSpots: true,
      label: "Register",
    },
    booking: { label: "Book a call", href: "/contact" },
    testimonials: { limit: 3, featuredOnly: true },
    faq: { pageKey: "camps", limit: 6 },
  }

  it.each(ISLAND_NAMES)("every trait of %s edits a prop its schema knows", (name) => {
    const result = parseIslandProps(name, CONFIGURED[name])
    expect(result.ok, `fixture for ${name} must be valid: ${JSON.stringify(result)}`).toBe(true)
    if (!result.ok) return

    for (const trait of ISLAND_TRAITS[name]) {
      expect(trait.label.length).toBeGreaterThan(0)
      expect(
        result.props,
        `${name}.${trait.name} is edited by a trait but the schema drops it`,
      ).toHaveProperty(trait.name)
    }
  })

  it("rejects a redirectUrl that is not a site path or an https URL on the owner's own domain", () => {
    // FunnelForm assigns this to window.location.href right after a visitor
    // submits their email, so an unvalidated value is an open redirect. A
    // host allowlist closes the remaining hole: after the scheme check,
    // https://<any-host> still validated, which could hand a lead straight
    // to a third-party page under the owner's own brand — calendly.com was
    // previously (wrongly) asserted "allowed" here; it is now rejected same
    // as any other off-domain host. See __tests__/lib/funnels/islands.test.ts
    // for the exhaustive bypass/legitimate-case coverage.
    const base = {
      formKey: "optin",
      fields: [{ name: "email", label: "Email", type: "email" }],
      successMode: "redirect",
    }
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<script>",
      "//evil.example",
      "https://attacker.example/",
      "https://calendly.com/djp",
    ]) {
      const result = parseIslandProps("form", { ...base, redirectUrl: bad })
      expect(result.ok, `redirectUrl "${bad}" must be rejected`).toBe(false)
    }
    for (const good of ["/go/thanks", "https://www.darrenjpaul.com/x", "https://darrenjpaul.com/y"]) {
      const result = parseIslandProps("form", { ...base, redirectUrl: good })
      expect(result.ok, `redirectUrl "${good}" should be allowed`).toBe(true)
    }
  })

  it("ships placeholder defaults that deliberately fail validation", () => {
    // checkout/event/faq default to an empty required id on purpose: dropping
    // the block and publishing without configuring it must be refused with a
    // named field, not silently rendered as nothing.
    for (const name of ["checkout", "event", "faq"] as const) {
      const result = parseIslandProps(name, ISLANDS[name].defaultProps)
      expect(result.ok, `${name} defaults should not validate until configured`).toBe(false)
    }
  })

  it("gives every select trait at least two options", () => {
    for (const name of ISLAND_NAMES) {
      for (const trait of ISLAND_TRAITS[name]) {
        if (trait.type !== "select") continue
        expect(trait.options?.length ?? 0, `${name}.${trait.name}`).toBeGreaterThan(1)
      }
    }
  })
})

describe("readIslandProps", () => {
  it("falls back to defaults when the attribute is missing or corrupt", () => {
    expect(readIslandProps(undefined, "faq")).toEqual(ISLANDS.faq.defaultProps)
    expect(readIslandProps("{not json}", "faq")).toEqual(ISLANDS.faq.defaultProps)
    expect(readIslandProps("[1,2]", "faq")).toEqual(ISLANDS.faq.defaultProps)
  })

  it("parses real props", () => {
    expect(readIslandProps('{"pageKey":"camps","limit":3}', "faq")).toEqual({
      pageKey: "camps",
      limit: 3,
    })
  })
})

describe("buildIslandProps", () => {
  const values: Record<string, unknown> = {}
  const get = (n: string) => values[n]

  it("writes a text trait through to props", () => {
    const out = buildIslandProps({ label: "Buy now" }, "checkout", (n) =>
      n === "label" ? "Get started" : undefined,
    )
    expect(out.label).toBe("Get started")
  })

  it("keeps untouched props untouched", () => {
    const out = buildIslandProps({ label: "Buy now", productId: "abc" }, "checkout", () => undefined)
    expect(out).toEqual({ label: "Buy now", productId: "abc" })
  })

  it("removes a prop the owner deliberately cleared", () => {
    // Previously an empty string was skipped, so clearing a field left the old
    // value in place and the owner could not undo a setting.
    const out = buildIslandProps({ label: "Buy now" }, "checkout", (n) =>
      n === "label" ? "" : undefined,
    )
    expect(out).not.toHaveProperty("label")
  })

  it("coerces a number trait", () => {
    const out = buildIslandProps({ limit: 6 }, "faq", (n) => (n === "limit" ? "9" : undefined))
    expect(out.limit).toBe(9)
  })

  it("coerces a checkbox trait to a boolean", () => {
    const out = buildIslandProps({ featuredOnly: false }, "testimonials", (n) =>
      n === "featuredOnly" ? true : undefined,
    )
    expect(out.featuredOnly).toBe(true)
  })

  it("parses a json trait and keeps the old value when it is invalid", () => {
    const fields = [{ name: "email", label: "Email", type: "email" }]
    const ok = buildIslandProps({ fields: [] }, "form", (n) =>
      n === "fields" ? JSON.stringify(fields) : undefined,
    )
    expect(ok.fields).toEqual(fields)

    const bad = buildIslandProps({ fields }, "form", (n) => (n === "fields" ? "{oops" : undefined))
    expect(bad.fields).toEqual(fields)
  })

  it("produces props the compiler will accept end to end", () => {
    values.formKey = "optin"
    values.submitLabel = "Get the guide"
    values.successMode = "redirect"
    values.redirectUrl = "/go/thanks"
    values.fields = JSON.stringify([{ name: "email", label: "Email", type: "email" }])

    const props = buildIslandProps(
      { ...ISLANDS.form.defaultProps },
      "form" as IslandName,
      get,
    )
    const result = parseIslandProps("form", props)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // successMode is now reachable from the UI, so redirect actually applies.
    expect(result.props.successMode).toBe("redirect")
    expect(result.props.redirectUrl).toBe("/go/thanks")
  })
})
