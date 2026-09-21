// @vitest-environment node
//
// Structure of migration 00275 — take the five SECURITY DEFINER functions off
// the public RPC surface.
//
// WHAT THESE FUNCTIONS DO WITHOUT ANY CALLER CHECK. Measured on production
// 2026-09-21 by reading `pg_get_functiondef`, not by inference:
//
//   create_message(conversation_id, sender_user_id, sender_role, body, ...)
//     inserts a message with a CALLER-SUPPLIED sender id and sender role, and
//     never checks that the caller is that user or is in that conversation.
//     SECURITY DEFINER, so the messaging RLS policies do not apply.
//   confirm_event_signup / cancel_event_signup(signup_id, business_id)
//     flip a signup's state and move `events.signup_count`. No caller check.
//   create_form_review_message_with_attachment(...)  same shape.
//   is_messaging_admin()  leaks an authorization answer to the caller.
//
// Being fair about severity: all of these need a UUID the caller should not
// have, so in practice they are gated by UUID entropy. That is obscurity, not
// authorization, and it is not the control anyone would choose -- but it is
// the reason this is a smaller live risk than the thirteen open tables in
// 00274, which need no secret at all.
//
// THE TRAP THIS MIGRATION EXISTS TO AVOID. Three of the five carry `=X/postgres`
// in `proacl` -- an EXECUTE grant to PUBLIC. Revoking from `anon` and
// `authenticated` alone leaves every one of them fully callable through the
// grant to PUBLIC, producing a migration that reads like a fix and changes
// nothing. The revoke MUST name PUBLIC.
//
// `is_messaging_admin` IS DIFFERENT AND MUST KEEP `authenticated`. It is called
// inside the RLS policy expressions on `messages`, `message_reactions`,
// `message_attachments` and `conversations`, all of which are `TO authenticated`.
// Postgres checks EXECUTE permission on a function called from a policy as the
// querying role, so revoking it from `authenticated` makes all four policies
// throw instead of filtering. That is the one change here that could take a
// logged-in surface down.
//
// Comments are stripped before the statement assertions -- whole-line and
// trailing -- because this header names every function and discusses PUBLIC,
// GRANT and DROP in prose.

import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

const RAW = readFileSync(join(process.cwd(), "supabase/migrations/00275_revoke_anon_security_definer_rpcs.sql"), "utf8")
const SQL = RAW.split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .map((line) => (line.includes("'") ? line : line.replace(/--.*$/, "")))
  .join("\n")

/** Functions revoked from PUBLIC + anon + authenticated. */
function fullRevoke(): string[] {
  const m = SQL.match(/full_revoke\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/)
  expect(m, "migration declares no full_revoke array").not.toBeNull()
  return [...(m?.[1] ?? "").matchAll(/'([^']+)'/g)].map((x) => x[1])
}

/** Functions revoked from PUBLIC + anon only, keeping `authenticated`. */
function keepAuthenticated(): string[] {
  const m = SQL.match(/keep_authenticated\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/)
  expect(m, "migration declares no keep_authenticated array").not.toBeNull()
  return [...(m?.[1] ?? "").matchAll(/'([^']+)'/g)].map((x) => x[1])
}

describe("00275 — the five anon-callable SECURITY DEFINER functions", () => {
  it("revokes the four unauthorized writers, as an exact set", () => {
    expect(fullRevoke().slice().sort()).toEqual(
      [
        "cancel_event_signup",
        "confirm_event_signup",
        "create_form_review_message_with_attachment",
        "create_message",
      ].sort(),
    )
  })

  it("treats is_messaging_admin separately, and ONLY is_messaging_admin", () => {
    // If this ever grows a second entry, someone has put a function that the
    // RLS policies do not call into the keep-authenticated bucket, which is
    // the lenient path.
    expect(keepAuthenticated()).toEqual(["is_messaging_admin"])
  })

  it("never puts the same function in both buckets", () => {
    const overlap = fullRevoke().filter((f) => keepAuthenticated().includes(f))
    expect(overlap, `both buckets claim ${overlap.join(", ")}`).toEqual([])
  })

  it("REVOKES FROM PUBLIC — without this the whole migration is a no-op", () => {
    // Three of the five carry `=X/postgres`, a grant to PUBLIC. anon and
    // authenticated both inherit EXECUTE through it, so a revoke that names
    // only those two roles leaves the functions callable and the migration
    // verifiably green-but-useless.
    expect(SQL).toMatch(/REVOKE EXECUTE ON FUNCTION[\s\S]{0,120}FROM PUBLIC/i)
    // NOT a count of `FROM PUBLIC` occurrences. There are exactly two in the
    // file and the SECOND one is the wording of the closing RAISE NOTICE, so
    // the old `>= 2` assertion was pinned to a log message: rewording the
    // notice turned the suite red, and the thing it claimed to check was
    // never checked at all. The revoke is a single shared statement covering
    // both buckets -- its position, not its multiplicity, is what matters,
    // and that is asserted in the branch test below.
    expect(SQL).toMatch(/EXECUTE format\('REVOKE EXECUTE ON FUNCTION public\.%I\(%s\) FROM PUBLIC'/)
  })

  it("revokes PUBLIC and anon UNCONDITIONALLY, before the bucket branch", () => {
    // Not a count of occurrences: the loop runs one shared revoke for both
    // buckets, which is stronger than two copies because the two paths cannot
    // drift apart. What has to be true is that the PUBLIC and anon revokes sit
    // OUTSIDE `IF fn.revoke_authenticated`, so `is_messaging_admin` -- the one
    // function in the lenient bucket -- still loses anon.
    const branchAt = SQL.indexOf("IF fn.revoke_authenticated THEN")
    expect(branchAt, "no bucket branch found").toBeGreaterThan(-1)
    const beforeBranch = SQL.slice(0, branchAt)
    expect(beforeBranch, "PUBLIC revoke is inside the branch").toMatch(/FROM PUBLIC/i)
    expect(beforeBranch, "anon revoke is inside the branch").toMatch(/FROM anon/i)
  })

  it("revokes authenticated ONLY in the full bucket, and re-grants it in the other", () => {
    // THE SAFETY-CRITICAL ASSERTION. `is_messaging_admin` losing
    // `authenticated` makes six RLS policies throw instead of filter.
    //
    // Checking only that a `GRANT ... TO authenticated` string EXISTS is not
    // enough: swapping the two arms of the IF -- revoking from the bucket
    // that must keep it, granting to the bucket that must lose it -- leaves
    // both strings present and passed every test in this file. So each arm is
    // sliced out and asserted on its own.
    const branch = SQL.slice(SQL.indexOf("IF fn.revoke_authenticated THEN"))
    const thenArm = branch.slice(0, branch.indexOf("ELSE"))
    const elseArm = branch.slice(branch.indexOf("ELSE"), branch.indexOf("END IF;"))

    expect(thenArm, "the full-revoke arm does not revoke authenticated").toMatch(/REVOKE[\s\S]*FROM authenticated/i)
    expect(thenArm, "the full-revoke arm grants authenticated").not.toMatch(/GRANT/i)

    expect(elseArm, "the keep arm does not grant authenticated").toMatch(/GRANT[\s\S]*TO authenticated/i)
    expect(elseArm, "the keep arm revokes authenticated").not.toMatch(/REVOKE/i)
  })

  it("resolves overloads from pg_proc rather than hard-coding a signature", () => {
    // A bare `REVOKE ... ON FUNCTION create_message` fails outright if the
    // function is ever overloaded, and a hard-coded argument list silently
    // misses the overload that was added. Identity args come from the catalog.
    expect(SQL).toMatch(/pg_get_function_identity_arguments/)
    expect(SQL).toMatch(/pg_proc/)
  })

  it("keeps service_role, which is how the app actually calls all four", () => {
    // lib/db/messages.ts, lib/db/form-reviews.ts and lib/db/event-signups.ts
    // reach these through createServiceRoleClient(). Revoking service_role
    // would break the messaging send, the form-review attachment and the
    // event signup confirm/cancel.
    expect(SQL).not.toMatch(/FROM service_role/i)
    // NOT `/REVOKE[\s\S]{0,80}service_role/i` -- that matched the identifier
    // `full_revoke` sitting within 80 characters of a `service_role` mention
    // in the verification query. A substring of a variable name is not a
    // statement. Anchor on the statement form instead.
    expect(SQL).not.toMatch(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION[^;]*service_role/i)
    // And assert the positive: the migration proves service_role kept it.
    expect(SQL).toMatch(/has_function_privilege\('service_role'/)
    expect(SQL).toMatch(/RAISE EXCEPTION[\s\S]{0,200}lost EXECUTE for service_role/)
  })

  it("VERIFIES the end state with has_function_privilege, not information_schema", () => {
    // information_schema.role_routine_grants has the same blind spot as
    // role_table_grants -- it filters by what the querying role can see.
    // Named per ROLE. A bare `/has_function_privilege/` passes while the anon
    // check specifically is disabled, because the authenticated and
    // service_role checks keep the string present -- which is exactly how this
    // assertion let its own mutant through.
    expect(SQL).toMatch(/has_function_privilege\('anon', p\.oid, 'EXECUTE'\)/)
    expect(SQL).toMatch(/has_function_privilege\('authenticated', p\.oid, 'EXECUTE'\)/)
    expect(SQL).not.toMatch(/information_schema/i)
    expect(SQL).toMatch(/RAISE EXCEPTION[\s\S]{0,180}still executable/)
  })

  it("verifies authenticated RETAINED execute on is_messaging_admin", () => {
    // Asserting the negative alone would pass a migration that locked the
    // policies out. This is the presence control for that absence check.
    //
    // The role is named. `/lost EXECUTE/` alone is satisfied by the
    // service_role raise further down the same file, so the mutant that
    // downgraded THIS raise to a NOTICE survived it.
    expect(SQL).toMatch(/RAISE EXCEPTION[\s\S]{0,60}lost EXECUTE for authenticated/)
  })

  it("demands the FULL set, not merely one -- a single renamed function must fail", () => {
    // `revoked_count = 0` catches only the case where every name is wrong. If
    // ONE function is renamed upstream the loop covers the other four and the
    // `leaked` read-back keys on the same array, so it cannot see the missing
    // one either: a green migration with a SECURITY DEFINER writer still
    // callable by the internet. The comparison itself is pinned, because
    // matching the raise text alone let both the `= 0` and the
    // count-iterations mutants through.
    expect(SQL).toMatch(/IF cardinality\(seen\) <> cardinality\(full_revoke \|\| keep_authenticated\) THEN/)
    expect(SQL).toMatch(/RAISE EXCEPTION[\s\S]{0,160}revoked nothing/)
  })

  it("counts DISTINCT function names, so an overload cannot trip the set check", () => {
    // The loop walks pg_proc, so an overloaded function yields two rows for
    // one name. Counting iterations would overshoot the expected total and
    // make the all-or-nothing check raise on a healthy database.
    expect(SQL).toMatch(/IF NOT \(fn\.name = ANY \(seen\)\) THEN/)
    expect(SQL).toMatch(/seen := seen \|\| fn\.name;/)
  })

  it("changes no function BODY and drops nothing", () => {
    // This migration is about who may call them, not what they do. Fixing the
    // missing authorization checks inside `create_message` is a separate piece
    // of work with its own tests.
    expect(SQL).not.toMatch(/CREATE OR REPLACE FUNCTION/i)
    expect(SQL).not.toMatch(/\bDROP\b/i)
    expect(SQL).not.toMatch(/SECURITY INVOKER/i)
  })
})
