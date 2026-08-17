// lib/funnels/checkout/roles.ts — form answers into a signup payload.
//
// ---------------------------------------------------------------------------
// THE MAPPING IS THE FORM'S DECLARATION, NOT A GUESS.
// ---------------------------------------------------------------------------
// Every value is located by `field.role`. Nothing reads a label, and nothing
// reads a field name — an owner may call the athlete's name field `player`,
// `child_name` or `kid`, and all three work because the form says which value it
// carries. This is the whole answer to the objection in
// `2026-08-15-funnel-anonymous-checkout-design.md`: the signup payload is not
// "synthesised by a button", it is declared by the form and gated at publish.
//
// The output is handed STRAIGHT to `createEventSignupSchema`, which the caller
// imports. This file never restates that schema's rules — its only job is to move
// values into the right keys and to turn HTML's strings into the types the schema
// asks for. Every rule about what is VALID stays in the validator.

import type { FunnelFormField } from "@/lib/funnels/islands"

/**
 * The shape `createEventSignupSchema` parses. Nullable and unbounded on purpose:
 * this is the INPUT to validation, so it must be able to express the invalid
 * values a visitor can actually submit — an empty age, a blank name — and let the
 * schema reject them with its own messages.
 */
export interface RoleMappedSignup {
  parent_name: string
  parent_email: string
  parent_phone: string | null
  athlete_name: string
  athlete_age: number | null
  sport: string | null
  notes: string | null
  waiver_accepted: boolean
}

/**
 * The label the owner gave a role, for error copy.
 *
 * Falls back to the role name only when no field claims it, which
 * `formIslandSchema` already makes impossible for a published checkout form.
 */
export function labelForRole(fields: FunnelFormField[], role: string): string {
  return fields.find((field) => field.role === role)?.label ?? role
}

export function signupInputFromRoles(fields: FunnelFormField[], values: Record<string, string>): RoleMappedSignup {
  const get = (role: string): string => {
    const field = fields.find((candidate) => candidate.role === role)
    if (!field) return ""
    return (values[field.name] ?? "").trim()
  }
  const orNull = (role: string): string | null => {
    const value = get(role)
    return value === "" ? null : value
  }

  // An unchecked checkbox submits NOTHING; a checked one submits "on". So
  // presence is the signal — but not blindly: a client can post any string, and
  // `Boolean("false")` is true. The three strings that look like a tick and mean
  // the opposite are rejected explicitly, because this is the legal gate.
  const ticked = get("waiver_accepted").toLowerCase()
  const waiverAccepted = ticked !== "" && ticked !== "false" && ticked !== "0" && ticked !== "off"

  // `Number("")` is 0 and `parseInt("13 years")` is 13 — neither is what an age
  // field means, and both would sail past a range check. Only a clean integer
  // string counts; anything else is null, which `createEventSignupSchema` rejects
  // with its own message.
  const rawAge = get("athlete_age")
  const athleteAge = /^\d{1,3}$/.test(rawAge) ? Number(rawAge) : null

  return {
    parent_name: get("parent_name"),
    parent_email: get("parent_email"),
    parent_phone: orNull("parent_phone"),
    athlete_name: get("athlete_name"),
    athlete_age: athleteAge,
    sport: orNull("sport"),
    notes: orNull("notes"),
    waiver_accepted: waiverAccepted,
  }
}
