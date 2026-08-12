/**
 * Seed a filmable team for the permissions walkthrough.
 *
 * `/admin/team` in the dev clone holds two rows, both video editors, both with
 * real personal email addresses. There is nothing to teach with — no permission
 * summaries, no view/manage tiers, no client assignments — and the addresses
 * must not appear in a video that gets shown to a new hire.
 *
 * This adds four staff members across four presets, one pending invite, and a
 * set of client assignments, then renames the two real rows to demo identities.
 * Every demo address is on `djpathlete.demo`, which cannot receive mail — that
 * is deliberate, because the recording clicks a real "Send invite" button.
 *
 * Idempotent: re-run it between takes. Chapters 2-5 all mutate state, so a
 * re-record of any one of them needs this run again first.
 *
 * Run:  node scripts/seed-team-demo.mjs --target <project-ref>
 *       node scripts/seed-team-demo.mjs --target <project-ref> --restore
 */
import { createClient } from "@supabase/supabase-js"
import * as dotenv from "dotenv"
import { randomBytes } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, "../.env.local") })

const argv = process.argv.slice(2)
const RESTORE = argv.includes("--restore")
const targetArg = (() => {
  const i = argv.indexOf("--target")
  return i >= 0 ? argv[i + 1] : null
})()

const DEMO_DOMAIN = "djpathlete.demo"
const BACKUP = path.join(process.cwd(), ".playwright-out", "team-demo-backup.json")

// ---------------------------------------------------------------------------
// Target guard
// ---------------------------------------------------------------------------

/**
 * Refuse to touch a database the caller did not name.
 *
 * This is an allowlist of one, supplied on the command line, rather than a
 * denylist on the production ref. A denylist has the wrong polarity: it passes
 * by default for any database it has never heard of, so the first time an env
 * file points somewhere new the guard silently stops guarding. Here, running
 * against production would mean deliberately typing production's ref.
 *
 * Nothing about which database is which is committed to the repo as a result.
 */
function resolveTarget() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from .env.local")

  const ref = new URL(url).hostname.split(".")[0]
  if (!targetArg) {
    throw new Error(
      `refusing to run without --target.\n` +
        `  .env.local currently points at: ${ref}\n` +
        `  re-run with: node scripts/seed-team-demo.mjs --target ${ref}`,
    )
  }
  if (targetArg !== ref) {
    throw new Error(`--target ${targetArg} does not match the database in .env.local (${ref}). Refusing.`)
  }
  console.log(`target: ${ref}`)
  return createClient(url, key)
}

// ---------------------------------------------------------------------------
// The cast
// ---------------------------------------------------------------------------

/**
 * `staff_role` is the preset key, and the table reads its role badge off it —
 * a member with permissions but no preset key renders as "Custom". The
 * permission maps are the presets from lib/permissions/registry.ts, so what the
 * video shows in the Access column is what the invite dialog would have filled
 * in.
 *
 * created_at is set explicitly: the members list is ordered newest-first, and
 * a filmed table looks wrong when the dates are all today.
 */
const STAFF = [
  {
    id: "d9b1a5e0-0000-4000-8000-000000000001",
    email: `marcus.bell@${DEMO_DOMAIN}`,
    first_name: "Marcus",
    last_name: "Bell",
    staff_role: "coach",
    permissions: { clients: true, programs: true, schedule: true, form_reviews: true, messages: true },
    status: "active",
    created_at: "2026-07-28T14:20:00.000Z",
    assign_clients: 4,
  },
  {
    id: "d9b1a5e0-0000-4000-8000-000000000002",
    email: `priya.raman@${DEMO_DOMAIN}`,
    first_name: "Priya",
    last_name: "Raman",
    staff_role: "marketing",
    permissions: {
      blog: true, social: true, website: true, funnels: true, seo: true, leads: true, analytics: "view",
    },
    status: "active",
    created_at: "2026-06-14T09:05:00.000Z",
    assign_clients: 0,
  },
  {
    id: "d9b1a5e0-0000-4000-8000-000000000003",
    email: `joanne.wu@${DEMO_DOMAIN}`,
    first_name: "Joanne",
    last_name: "Wu",
    staff_role: "bookkeeper",
    permissions: { accounting: "manage", payments: "view", analytics: "view" },
    status: "active",
    created_at: "2026-05-02T16:45:00.000Z",
    assign_clients: 0,
  },
  {
    id: "d9b1a5e0-0000-4000-8000-000000000004",
    email: `tess.okafor@${DEMO_DOMAIN}`,
    first_name: "Tess",
    last_name: "Okafor",
    staff_role: "front_desk",
    permissions: { clients: true, schedule: true, messages: true, leads: true },
    status: "suspended",
    created_at: "2026-03-19T11:30:00.000Z",
    assign_clients: 0,
  },
]

/**
 * Demo identities for the two real editor rows. They are renamed rather than
 * deleted — they are real accounts in a clone of production, and --restore has
 * to be able to put them back exactly.
 */
const EDITOR_ALIASES = [
  { first_name: "Danny", last_name: "Cruz", email: `danny.cruz@${DEMO_DOMAIN}` },
  { first_name: "Nina", last_name: "Alvarez", email: `nina.alvarez@${DEMO_DOMAIN}` },
]

/**
 * A pending invite that exists BEFORE filming, so chapter 5's resend/revoke has
 * a target without depending on chapter 3 having run. Each chapter records in
 * its own browser context precisely so it can be re-recorded alone; a chapter
 * that needs an earlier chapter's side effect throws that away.
 */
const PENDING_INVITE = {
  email: `alex.reyes@${DEMO_DOMAIN}`,
  staff_role: "coach",
  permissions: { clients: true, programs: true, schedule: true, form_reviews: true, messages: true },
}

/** The address chapter 2 types on camera. Cleared here so a re-record doesn't hit the unique index. */
const FILMED_INVITE_EMAIL = `sam.whitfield@${DEMO_DOMAIN}`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ownerId(supabase) {
  const { data, error } = await supabase.from("users").select("id").eq("role", "admin").limit(1).single()
  if (error || !data) throw new Error("no admin user found — cannot attribute invites or assignments")
  return data.id
}

/**
 * Remove a previous run's seed — and NOTHING else.
 *
 * Deletion is by the fixed ids above, never by the demo email domain. Those two
 * are not equivalent: this script also renames real team rows INTO the demo
 * domain, which makes "email ends in djpathlete.demo" true of accounts that
 * must never be deleted. Matching on the domain deleted two real editor rows on
 * 2026-08-12, and `users` has ~53 cascading foreign keys, so it took their
 * video submissions with it.
 *
 * The ids are the discriminator because this script is the only thing that ever
 * mints them.
 */
async function clearDemoRows(supabase) {
  // team_member_clients cascades on user delete.
  // Both matchers are things this script mints and nothing else uses: the fixed
  // ids, and the four staff addresses. The aliases live on the same domain but
  // are different addresses, so neither matcher can reach them.
  const { error: idErr } = await supabase.from("users").delete().in("id", STAFF.map((s) => s.id))
  if (idErr) throw idErr
  const { error: userErr } = await supabase.from("users").delete().in("email", STAFF.map((s) => s.email))
  if (userErr) throw userErr
  const { error: inviteErr } = await supabase
    .from("team_invites")
    .delete()
    .in("email", [PENDING_INVITE.email, FILMED_INVITE_EMAIL])
  if (inviteErr) throw inviteErr
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

async function restore(supabase) {
  if (!fs.existsSync(BACKUP)) throw new Error(`no backup at ${BACKUP} — nothing to restore`)
  const saved = JSON.parse(fs.readFileSync(BACKUP, "utf8"))

  for (const row of saved.editors ?? []) {
    const { error } = await supabase
      .from("users")
      .update({ email: row.email, first_name: row.first_name, last_name: row.last_name })
      .eq("id", row.id)
    if (error) throw error
    console.log(`  restored ${row.email}`)
  }

  await clearDemoRows(supabase)
  fs.rmSync(BACKUP)
  console.log("\ndemo rows removed, real identities restored")
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function seed(supabase) {
  const owner = await ownerId(supabase)

  // -- Reset any previous seed ----------------------------------------------
  // Before the rename below, so the sequence reads in the order it happens.
  // Correctness no longer depends on the ordering — clearDemoRows matches on
  // the fixed ids — but the two steps used to interact and it is worth keeping
  // them visibly separate.
  await clearDemoRows(supabase)

  // -- Neutralize the real rows ---------------------------------------------
  // Capture the originals ONCE. Re-running the seed after a rename would
  // otherwise "back up" the demo aliases over the real values and --restore
  // would cheerfully restore the fakes.
  const { data: realRows, error: realErr } = await supabase
    .from("users")
    .select("id, email, first_name, last_name")
    .in("role", ["staff", "editor"])
    .not("email", "like", `%@${DEMO_DOMAIN}`)
    .order("created_at", { ascending: true })
  if (realErr) throw realErr

  if (realRows.length && !fs.existsSync(BACKUP)) {
    fs.mkdirSync(path.dirname(BACKUP), { recursive: true })
    fs.writeFileSync(BACKUP, JSON.stringify({ editors: realRows }, null, 2))
    console.log(`backed up ${realRows.length} real team row(s) -> ${BACKUP}`)
  }

  for (const [i, row] of realRows.entries()) {
    const alias = EDITOR_ALIASES[i % EDITOR_ALIASES.length]
    const { error } = await supabase.from("users").update(alias).eq("id", row.id)
    if (error) throw error
    console.log(`  renamed a real team row -> ${alias.first_name} ${alias.last_name}`)
  }

  // -- Staff ----------------------------------------------------------------
  const inserted = []
  for (const person of STAFF) {
    const { assign_clients, ...row } = person
    const { data, error } = await supabase
      .from("users")
      // password_hash is nullable since 00125 — these accounts are never signed
      // into, the walkthrough only ever films the owner's screen.
      .insert({ ...row, role: "staff" })
      .select("id, email")
      .single()
    if (error) throw error
    inserted.push({ id: data.id, email: data.email, assign_clients })
    console.log(`  + ${row.first_name} ${row.last_name} (${row.staff_role}${row.status === "suspended" ? ", suspended" : ""})`)
  }

  // -- Client assignments ---------------------------------------------------
  const { data: clients, error: clientErr } = await supabase
    .from("users")
    .select("id")
    .eq("role", "client")
    .limit(20)
  if (clientErr) throw clientErr

  for (const person of inserted) {
    if (!person.assign_clients) continue
    // The FIRST N clients. Chapter 4 films ticking someone new, so its search
    // term in walkthroughs/team-permissions.mjs must fall outside this window.
    const picked = clients.slice(0, person.assign_clients)
    if (picked.length < person.assign_clients) {
      console.warn(`  ! only ${picked.length} clients available for ${person.email}`)
    }
    if (!picked.length) continue
    const { error } = await supabase.from("team_member_clients").insert(
      picked.map((c) => ({ staff_user_id: person.id, client_id: c.id, assigned_by: owner })),
    )
    if (error) throw error
    console.log(`  assigned ${picked.length} clients to ${person.email}`)
  }

  // -- Pending invite -------------------------------------------------------
  const { error: inviteErr } = await supabase.from("team_invites").insert({
    email: PENDING_INVITE.email,
    role: "staff",
    staff_role: PENDING_INVITE.staff_role,
    permissions: PENDING_INVITE.permissions,
    token: randomBytes(24).toString("base64url"),
    invited_by: owner,
    // Comfortably inside the 7-day window so it films as "Invite pending".
    expires_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
  })
  if (inviteErr) throw inviteErr
  console.log(`  + pending invite to ${PENDING_INVITE.email}`)
  console.log(`  (cleared ${FILMED_INVITE_EMAIL} so chapter 2 can send it again)`)

  console.log("\nseeded. /admin/team is filmable.")
}

// ---------------------------------------------------------------------------

async function main() {
  const supabase = resolveTarget()
  if (RESTORE) await restore(supabase)
  else await seed(supabase)
}

main().catch((e) => {
  console.error(`\n${e.message}`)
  process.exit(1)
})
