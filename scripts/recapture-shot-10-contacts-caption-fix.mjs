// Final holistic review, Minor — re-captures ONLY shot 10 of the phase-1
// multi-coach proof (screenshots/calendly-per-coach-phase1/), whose burned-in
// caption named the wrong mechanism.
//
// THE BUG. The original caption said `requireAdmin()` gates this page
// directly. That is wrong: for any path under `/admin`, `proxy.ts` resolves
// `canAccessPath({role:"staff",...}, "/admin/contacts", method)`
// (lib/permissions/registry.ts) BEFORE `app/(admin)/admin/contacts/page.tsx`
// (and its `requireAdmin()` call) ever runs. `/admin/contacts` has no rule in
// `PATH_PERMISSIONS`, so `resolvePathRequirement` returns `kind: "unmapped"`,
// `canAccessPath` returns `false` (registry.ts:611, the `owner_only`/
// `unmapped` case), and proxy.ts's staff branch redirects straight to
// `NO_ACCESS_PATH` (`/admin/no-access`). `requireAdmin()` never gets the
// chance to run. The screen shown is real; the caption's causal claim was
// not.
//
// WHY THIS SCRIPT EXISTS RATHER THAN RE-RUNNING THE FULL CAPTURE SUITE.
// scripts/capture-phase1-multicoach-screenshots.mjs creates a brand NEW
// business AND a brand new coach every run (see its own header comment) —
// re-running it to fix one caption would leave an orphaned business behind on
// the dev clone for no reason.
//
// This script instead invites a SECOND, TEMPORARY coach into the business a
// prior run already created and left on the dev clone ("Trailhead Strength &
// Conditioning", read back below by name rather than a hard-coded id) — no
// new business. Everything is done through the real running app: the real
// "Invite a coach" dialog, the real /invite/<token> claim form, a real
// sign-in. The temporary coach's business_members row, its team_invites row,
// and its users row are deleted again once the shot is captured — see the
// `finally` block. `linkHostToUser` (lib/db/business-members.ts) only claims
// a host row that is still `user_id IS NULL`; this business's one host row
// was already claimed by its first coach, so inviting a second coach cannot
// touch it.
//
//   npm run dev > /tmp/phase1-dev.log 2>&1 &
//   node scripts/recapture-shot-10-contacts-caption-fix.mjs

import { readFileSync, unlinkSync } from "node:fs"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { createClient } from "@supabase/supabase-js"

import { annotate } from "./_annotate-lib.mjs"

const DEV_REF = "anjvztjiokcgiyhobknq"
const APP = process.env.APP ?? "http://localhost:3050"
const OUT = "screenshots/calendly-per-coach-phase1"
const DSF = 2 // matches the original capture run

const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0]
if (ref !== DEV_REF) throw new Error(`DEV CLONE ONLY; refusing — env points at ${ref}`)
if (env.DEV_AUTH_BYPASS_ENABLED !== "true" || !env.DEV_AUTH_BYPASS_EMAIL) {
  throw new Error("DEV_AUTH_BYPASS_ENABLED/DEV_AUTH_BYPASS_EMAIL missing from .env.local")
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const RUN = Date.now().toString(36)
const TEMP_EMAIL = `screenshot-fix.${RUN}@djpathlete.demo`
const TEMP_PASSWORD = `Fix-${RUN}-Shot10!`
const TEMP_FIRST = "Recapture"
const TEMP_LAST = "Coach"

async function launchChromium() {
  try {
    return await chromium.launch()
  } catch (err) {
    const cache = join(process.env.HOME ?? "", "Library/Caches/ms-playwright")
    const shells = existsSync(cache)
      ? readdirSync(cache)
          .filter((d) => d.startsWith("chromium_headless_shell-"))
          .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
      : []
    for (const shell of shells) {
      const exe = join(cache, shell, "chrome-headless-shell-mac-arm64", "chrome-headless-shell")
      if (!existsSync(exe)) continue
      console.log(`  playwright's own build is missing; falling back to ${shell}`)
      return await chromium.launch({ executablePath: exe })
    }
    throw new Error(`no usable chromium. ${String(err).split("\n")[0]}`)
  }
}

async function hideFloatingChrome(page) {
  await page.addStyleTag({
    content: `nextjs-portal, [aria-label="Messages"], [aria-label^="Messages,"], [class*="intercom"], [id*="intercom"] { display: none !important; }`,
  })
}

async function markerOn(page, locator, caption, { dx = 0, dy = 0, place = "left" } = {}) {
  const n = await locator.count()
  if (n === 0) {
    console.warn(`  !! MARKER TARGET NOT FOUND — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  if (n > 1) console.warn(`  !! MARKER TARGET MATCHED ${n} ELEMENTS, using the first: "${caption.slice(0, 60)}…"`)
  const box = await locator.first().boundingBox()
  if (!box) {
    console.warn(`  !! MARKER TARGET HAS NO BOX — caption mispositioned: "${caption.slice(0, 60)}…"`)
    return { x: 100, y: 100, caption }
  }
  let cx
  let cy = box.y + box.height / 2
  if (place === "right") cx = box.x + box.width + 22
  else if (place === "above") {
    cx = box.x + box.width / 2
    cy = box.y - 22
  } else cx = box.x - 22
  return { x: Math.round((cx + dx) * DSF), y: Math.round((cy + dy) * DSF), caption }
}

const browser = await launchChromium()
let newUserId = null
let inviteId = null
let businessId = null
let businessName = null

try {
  console.log("reading back the existing second business left by a prior capture run")
  const { data: existingBusinesses, error: bizErr } = await db
    .from("businesses")
    .select("id, name")
    .neq("id", "00000000-0000-0000-0000-000000000001")
    .order("created_at", { ascending: false })
    .limit(1)
  if (bizErr) throw new Error(`businesses read failed: ${bizErr.code} ${bizErr.message}`)
  if (!existingBusinesses || existingBusinesses.length === 0) {
    throw new Error("no non-singleton business exists on the dev clone — run the full capture script once first, this recapture script deliberately does not create a business")
  }
  businessId = existingBusinesses[0].id
  businessName = existingBusinesses[0].name
  console.log(`   using "${businessName}" (${businessId}) — created by an earlier run, unmodified by this script except for one temporary invite`)

  const opCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: DSF })
  const admin = await opCtx.newPage()

  console.log("\nsigning in as the real operator (existing, admin-gated dev-login route)")
  await admin.goto(`${APP}/api/dev/login?callbackUrl=/admin/businesses/${businessId}`, { waitUntil: "domcontentloaded" })
  await admin.waitForURL(new RegExp(`/admin/businesses/${businessId}$`), { timeout: 20_000 })
  await admin.waitForLoadState("networkidle")
  await admin.waitForTimeout(400)

  console.log(`\ninviting a temporary second coach (${TEMP_EMAIL}) into the existing business`)
  await admin.getByRole("button", { name: "Invite a coach" }).click()
  await admin.locator("#member-invite-email").fill(TEMP_EMAIL)
  await admin.getByRole("button", { name: "Send invite" }).click()
  const inviteLinkInput = admin.getByRole("dialog").locator('input[readonly]')
  await inviteLinkInput.waitFor({ timeout: 10_000 })
  const inviteLink = await inviteLinkInput.inputValue()
  if (!inviteLink.includes("/invite/")) throw new Error(`invite link looks wrong: "${inviteLink}"`)
  const token = inviteLink.split("/invite/")[1]
  console.log(`   invite link: ${inviteLink}`)

  const { data: inviteRow, error: inviteErr } = await db
    .from("team_invites")
    .select("id")
    .eq("token", token)
    .maybeSingle()
  if (inviteErr) throw new Error(`invite read-back failed: ${inviteErr.code} ${inviteErr.message}`)
  if (!inviteRow) throw new Error("invite was created through the dialog but cannot be read back by token")
  inviteId = inviteRow.id
  await opCtx.close()

  console.log(`\nclaiming the invite as a brand-new account — a SEPARATE browser context`)
  const coachCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: DSF })
  const coach = await coachCtx.newPage()
  await coach.goto(inviteLink, { waitUntil: "networkidle" })
  await coach.waitForTimeout(400)
  await coach.locator("#firstName").fill(TEMP_FIRST)
  await coach.locator("#lastName").fill(TEMP_LAST)
  await coach.locator("#password").fill(TEMP_PASSWORD)
  await coach.getByRole("button", { name: "Accept and continue" }).click()
  await coach.waitForURL((u) => !u.pathname.startsWith("/invite/"), { timeout: 15_000 })
  await coach.waitForTimeout(300)

  const { data: coachUser, error: coachErr } = await db
    .from("users")
    .select("id, email, role")
    .eq("email", TEMP_EMAIL)
    .maybeSingle()
  if (coachErr) throw new Error(`read-back failed: ${coachErr.code} ${coachErr.message}`)
  if (!coachUser) throw new Error(`no user row for ${TEMP_EMAIL} — the claim reported success but created nothing`)
  newUserId = coachUser.id
  console.log(`   real account created: ${coachUser.id} role=${coachUser.role}`)
  const { data: membership, error: memberErr } = await db
    .from("business_members")
    .select("business_id, role")
    .eq("user_id", coachUser.id)
    .eq("business_id", businessId)
    .maybeSingle()
  if (memberErr) throw new Error(`membership read failed: ${memberErr.code} ${memberErr.message}`)
  if (!membership) throw new Error(`claim created the user but no business_members row links them to ${businessId}`)
  console.log(`   membership: ${JSON.stringify(membership)}`)

  console.log(`\nthe coach's real attempt at /admin/contacts`)
  await coach.goto(`${APP}/admin/contacts`, { waitUntil: "networkidle" })
  await coach.waitForTimeout(400)
  const landedOnNoAccess = coach.url().endsWith("/admin/no-access")
  if (!landedOnNoAccess) {
    throw new Error(`expected a redirect to /admin/no-access, landed on ${coach.url()} instead — the mechanism this shot documents may have changed`)
  }
  console.log(`   confirmed: landed on ${coach.url()}`)

  const name = "10-admin-contacts-coach-no-access"
  const raw = `${OUT}/.raw-${name}.png`
  await hideFloatingChrome(coach)
  await coach.screenshot({ path: raw, fullPage: true })
  const r = await annotate(raw, `${OUT}/${name}.png`, {
    title: "/admin/contacts is unmapped — the proxy denies it before the page ever runs",
    // SHORT, DELIBERATELY: annotate()'s subtitle is a single SVG <text> line
    // with no wrapping (only marker captions wrap) — a long subtitle silently
    // runs off the right edge of the band instead of erroring. The full
    // explanation lives in the marker caption below, which does wrap.
    subtitle: `proxy.ts denies "/admin/contacts" before the page loads — it has no rule in PATH_PERMISSIONS, so requireAdmin() never runs.`,
    markers: [
      await markerOn(
        coach,
        coach.locator("h1"),
        `"That area isn't part of your access" — shown because canAccessPath() found no PATH_PERMISSIONS rule for this path (lib/permissions/registry.ts:611). requireAdmin() never ran for ${businessName}'s coach; the proxy already redirected before the page component rendered. This is the real result of the real attempt, not staged.`,
        { place: "right" },
      ),
    ],
  })
  unlinkSync(raw)
  console.log(`  ${name}.png  ${r.width}x${r.height}`)
  await coachCtx.close()
} finally {
  await browser.close()

  console.log("\ncleaning up the temporary coach created for this recapture")
  if (newUserId && businessId) {
    const { error } = await db.from("business_members").delete().eq("business_id", businessId).eq("user_id", newUserId)
    if (error) console.error(`  !! FAILED to delete business_members row: ${error.code} ${error.message}`)
    else console.log(`   deleted business_members (${businessId}, ${newUserId})`)
  }
  if (inviteId) {
    const { error } = await db.from("team_invites").delete().eq("id", inviteId)
    if (error) console.error(`  !! FAILED to delete team_invites row ${inviteId}: ${error.code} ${error.message}`)
    else console.log(`   deleted team_invites ${inviteId}`)
  }
  if (newUserId) {
    const { error } = await db.from("users").delete().eq("id", newUserId)
    if (error) console.error(`  !! FAILED to delete users row ${newUserId}: ${error.code} ${error.message}`)
    else console.log(`   deleted users ${newUserId}`)
  }

  if (newUserId) {
    const { data: leftover } = await db.from("users").select("id").eq("id", newUserId).maybeSingle()
    if (leftover) console.error(`  !! CLEANUP DID NOT TAKE — user ${newUserId} still exists`)
    else console.log("   confirmed: no trace of the temporary coach remains")
  }
}
console.log("\ndone — no new business created; the temporary coach was deleted")
