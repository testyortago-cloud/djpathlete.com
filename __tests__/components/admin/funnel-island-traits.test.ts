// Covers `lib/funnels/island-fields.ts` (was
// `components/admin/funnels/island-traits.ts` until Stage 1.10 moved it out of
// the deleted GrapesJS editor folder).
//
// The `readIslandProps` / `buildIslandProps` suites that used to live at the
// bottom of this file went with `island-props.ts` in that same deletion — that
// module existed to translate GrapesJS trait widgets into `data-djp-props` and
// has no reader left. Everything below is about ISLAND_TRAITS itself and the
// island schemas, neither of which the deletion touched, so it stays.

import { describe, it, expect } from "vitest"
import { ISLAND_NAMES, ISLANDS, parseIslandProps, type IslandName } from "@/lib/funnels/islands"
import { ISLAND_TRAITS } from "@/lib/funnels/island-fields"

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
    quiz: {
      quizId: "33333333-3333-4333-8333-333333333333",
      submitLabel: "See my result",
      consentText: "We'll email your readout.",
    },
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

  it("rejects a redirectUrl that is not a site path or an https URL on an allowlisted host", () => {
    // FunnelForm assigns this to window.location.href right after a visitor
    // submits their email, so an unvalidated value is an open redirect. A
    // host allowlist closes the remaining hole: after the scheme check,
    // https://<any-host> still validated, which could hand a lead straight
    // to an arbitrary third-party page (https://attacker.example/ below).
    // See __tests__/lib/funnels/islands.test.ts for the exhaustive
    // bypass/legitimate-case coverage.
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
    ]) {
      const result = parseIslandProps("form", { ...base, redirectUrl: bad })
      expect(result.ok, `redirectUrl "${bad}" must be rejected`).toBe(false)
    }
    for (const good of [
      "/go/thanks",
      "https://www.darrenjpaul.com/x",
      "https://darrenjpaul.com/y",
      // Allowed by explicit owner policy (commit ed8bbfdc's message: "legitimate
      // thank-you pages live off-site (Calendly), so a host allowlist is an
      // owner policy call, not a silent default") — not an oversight. Do not
      // remove this without re-reading that commit.
      "https://calendly.com/djp",
    ]) {
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
