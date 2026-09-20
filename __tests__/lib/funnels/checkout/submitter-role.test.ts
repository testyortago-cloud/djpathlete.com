// @vitest-environment node
//
// G10. Who filled this funnel form in — the "parent or adult" half of the
// row, answered from what the FORM DECLARES about itself rather than from
// anything guessed about a label or a field name. Same rule the rest of
// lib/funnels/checkout/roles.ts keeps.
import { describe, it, expect } from "vitest"
import { submitterRole } from "@/lib/funnels/checkout/roles"
import type { FunnelFormField } from "@/lib/funnels/islands"

function field(over: Partial<FunnelFormField> & { name: string }): FunnelFormField {
  return { label: over.name, type: "text", required: false, ...over } as FunnelFormField
}

describe("submitterRole", () => {
  it("is 'parent' when the form asks for the parent's details separately from the athlete's", () => {
    // The camp/clinic checkout shape: `formIslandSchema` requires
    // parent_name, parent_email, athlete_name and athlete_age on any form
    // that takes payment, so this is every paid signup form there is.
    expect(
      submitterRole([
        field({ name: "your_name", role: "parent_name" }),
        field({ name: "your_email", role: "parent_email", type: "email" }),
        field({ name: "player_name", role: "athlete_name" }),
        field({ name: "player_age", role: "athlete_age" }),
      ]),
    ).toBe("parent")
  })

  it("is 'athlete' for an ordinary lead form, where the person is filling it in for themselves", () => {
    expect(
      submitterRole([
        field({ name: "name" }),
        field({ name: "email", type: "email" }),
        field({ name: "sport", role: "sport" }),
      ]),
    ).toBe("athlete")
  })

  it("is 'parent' on either parent field alone — the owner may only ask for one", () => {
    expect(submitterRole([field({ name: "a", role: "parent_name" })])).toBe("parent")
    expect(submitterRole([field({ name: "b", role: "parent_email", type: "email" })])).toBe("parent")
    expect(submitterRole([field({ name: "c", role: "parent_phone", type: "tel" })])).toBe("parent")
  })

  it("does not read the athlete's own fields as a parent signal", () => {
    // The control for the rule above: a form that asks for the athlete's
    // name and age and nothing about a parent is the athlete's own form.
    expect(submitterRole([field({ name: "d", role: "athlete_name" }), field({ name: "e", role: "athlete_age" })])).toBe(
      "athlete",
    )
  })

  it("does not read a LABEL or a field NAME as a signal", () => {
    // An owner who writes "Parent's name" on a field and tags no role has
    // not declared anything, and guessing from prose is exactly what
    // roles.ts's header forbids.
    expect(submitterRole([field({ name: "parent_name", label: "Parent's name" })])).toBe("athlete")
  })

  it("answers 'athlete' for a form with no fields at all rather than throwing", () => {
    expect(submitterRole([])).toBe("athlete")
  })
})
