/**
 * Sets a `system_settings` cron flag to true or false.
 *
 * There is no script for this and the only other surface is the admin UI's
 * toggle-cron route, which needs a browser session — so a cron cannot be
 * flipped from a terminal without hand-writing SQL against production
 * credentials. This is that step, with the same guardrails as
 * scripts/activate-sequence.mjs:
 *
 *   - prints the project host BEFORE writing, so a wrong env file is obvious
 *     rather than silent (the dev clone and production differ by one subdomain)
 *   - COMPARE-AND-SET on the current value: if the row changed between the read
 *     and the write, the update matches zero rows, the script says so and exits
 *     1 rather than clobbering someone else's change
 *   - re-selects and prints the persisted row afterwards, so the output is what
 *     the database actually holds and not what we hoped it would
 *   - --dry-run performs no write
 *
 *   node scripts/set-cron-flag.mjs .env.prod cron_sequence_tick_enabled true --dry-run
 *   node scripts/set-cron-flag.mjs .env.prod cron_sequence_tick_enabled true
 *   node scripts/set-cron-flag.mjs .env.prod cron_sequence_tick_enabled false
 */
import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

function parseEnv(path) {
  const out = {}
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
  return out
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes("--dry-run")
  const [envPath, key, rawValue] = args.filter((a) => a !== "--dry-run")

  if (!envPath || !key || rawValue === undefined) {
    console.error("usage: node scripts/set-cron-flag.mjs <env-file> <key> <true|false> [--dry-run]")
    process.exit(1)
  }
  if (rawValue !== "true" && rawValue !== "false") {
    console.error(`value must be "true" or "false", got "${rawValue}"`)
    process.exit(1)
  }
  const next = rawValue === "true"

  const env = parseEnv(envPath)
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(`${envPath} is missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`)
    process.exit(1)
  }

  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  console.log("project host:", new URL(env.NEXT_PUBLIC_SUPABASE_URL).host)

  const { data: before, error: readErr } = await sb
    .from("system_settings")
    .select("key, value")
    .eq("key", key)
    .maybeSingle()
  if (readErr) {
    console.error("read failed:", readErr.message)
    process.exit(1)
  }
  if (!before) {
    console.error(`no system_settings row for "${key}" — refusing to create one blind`)
    process.exit(1)
  }

  const current = before.value
  console.log(`setting "${key}": current value = ${JSON.stringify(current)}`)

  if (current === next) {
    console.log(`already ${next} — nothing to do`)
    return
  }
  if (dryRun) {
    console.log(`[dry-run] would set ${key} = ${next}`)
    console.log("[dry-run] no write performed")
    return
  }

  // Compare-and-set: guarded on the value we read.
  const { data: updated, error: writeErr } = await sb
    .from("system_settings")
    .update({ value: next })
    .eq("key", key)
    .eq("value", current)
    .select("key, value")
  if (writeErr) {
    console.error("write failed:", writeErr.message)
    process.exit(1)
  }
  if (!updated || updated.length === 0) {
    console.error(`row changed underneath us — expected value ${JSON.stringify(current)}; not written`)
    const { data: actual } = await sb.from("system_settings").select("key, value").eq("key", key).maybeSingle()
    console.error("actual now:", JSON.stringify(actual))
    process.exit(1)
  }

  const { data: after } = await sb.from("system_settings").select("key, value").eq("key", key).maybeSingle()
  console.log("system_settings set:", JSON.stringify(after))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
