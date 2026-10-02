/**
 * Replays a REAL production week/day request through THIS checkout's week
 * orchestrator, on the dev clone, and reports what a coach would see plus what
 * it cost. Built 2026-10-02 to prove the named-exercise / scoped-rule fixes and
 * to compare architect+selector models on equal inputs.
 *
 *   npx tsx scripts/replay-week-generation.ts --job <prod ai_jobs id> \
 *     --program <clone program id> --client <clone user id> --assignment <clone assignment id> \
 *     --week <N> [--day 1..7] [--label name] [--out tmp/replays.jsonl]
 *
 *   Models: PROGRAM_ARCHITECT_MODEL / EXERCISE_SELECTOR_MODEL (anthropic.ts) pick the pair.
 *
 * READS the production job doc (its instructions and pool settings) and writes
 * nothing there. WRITES the generated rows to the dev clone program, then
 * DELETES exactly the rows it added, so the same target can be replayed again.
 * Refuses any database but the dev clone, and refuses a target week/day that
 * already has rows (it would otherwise delete the coach's own work).
 *
 * Cost: every OpenRouter response's `usage` is summed per model (fetch is
 * wrapped before the SDK loads). Priced from OpenRouter's live model list;
 * `usage.cost`, when OpenRouter sends it, is reported beside the estimate.
 */
import { config } from "dotenv"
import path from "node:path"
import { appendFileSync } from "node:fs"

config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true })
process.env.GOOGLE_CLOUD_PROJECT ||= "probe-local"
process.env.GCLOUD_PROJECT ||= "probe-local"
process.env.SUPABASE_URL ||= process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
if (!process.env.SUPABASE_URL.includes("anjvztjiokcgiyhobknq")) {
  throw new Error(`Refusing to run: SUPABASE_URL is not the dev clone (${process.env.SUPABASE_URL})`)
}

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : args[i + 1]
}
const need = (name: string) => {
  const v = flag(name)
  if (!v) throw new Error(`--${name} is required`)
  return v
}

// ── OpenRouter usage, per model ──
type Usage = { calls: number; prompt: number; completion: number; cached: number; reported_cost: number }
const usage = new Map<string, Usage>()
function record(model: string, u: Record<string, any> | undefined) {
  if (!u) return
  const row = usage.get(model) ?? { calls: 0, prompt: 0, completion: 0, cached: 0, reported_cost: 0 }
  row.calls++
  row.prompt += u.prompt_tokens ?? 0
  row.completion += u.completion_tokens ?? 0
  row.cached += u.prompt_tokens_details?.cached_tokens ?? 0
  row.reported_cost += typeof u.cost === "number" ? u.cost : 0
  usage.set(model, row)
}
const realFetch = globalThis.fetch
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await realFetch(input, init)
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (url.includes("openrouter.ai")) {
    let model = "unknown"
    try {
      model = JSON.parse(String(init?.body ?? "{}")).model ?? model
    } catch {
      /* streaming or non-JSON body */
    }
    res
      .clone()
      .json()
      .then((j: { usage?: Record<string, any> }) => record(model, j?.usage))
      .catch(() => {})
  }
  return res
}

async function priceList(): Promise<Map<string, { prompt: number; completion: number; cache_read: number }>> {
  const r = await realFetch("https://openrouter.ai/api/v1/models")
  const j = (await r.json()) as { data: Array<{ id: string; pricing?: Record<string, string> }> }
  return new Map(
    j.data.map((m) => [
      m.id,
      {
        prompt: Number(m.pricing?.prompt ?? 0),
        completion: Number(m.pricing?.completion ?? 0),
        cache_read: Number(m.pricing?.input_cache_read ?? m.pricing?.prompt ?? 0),
      },
    ]),
  )
}

async function readJobRequest(jobId: string) {
  const { initializeApp, getApps, cert } = await import("firebase-admin/app")
  const { getFirestore } = await import("firebase-admin/firestore")
  const app =
    getApps().find((a) => a.name === "replay-reader") ??
    initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY ?? "{}")) }, "replay-reader")
  const snap = await getFirestore(app).collection("ai_jobs").doc(jobId).get()
  if (!snap.exists) throw new Error(`job ${jobId} not found`)
  return (snap.data() as { input?: { request?: Record<string, unknown> } }).input?.request ?? {}
}

async function main() {
  const jobId = need("job")
  const programId = need("program")
  const clientId = need("client")
  const assignmentId = need("assignment")
  const week = Number(need("week"))
  const day = flag("day") ? Number(flag("day")) : undefined
  const label = flag("label") ?? jobId
  const out = flag("out") ?? "tmp/replays.jsonl"

  const prod = await readJobRequest(jobId)
  const instructions = String(prod.admin_instructions ?? "")

  const { getSupabase } = await import("../functions/src/lib/supabase.js")
  const supabase = getSupabase()
  const scope = () => {
    let q = supabase.from("program_exercises").select("id").eq("program_id", programId).eq("week_number", week)
    if (day !== undefined) q = q.eq("day_of_week", day)
    return q
  }
  const before = await scope()
  if (before.error) throw before.error
  if ((before.data ?? []).length > 0) {
    throw new Error(`Refusing: week ${week}${day ? ` day ${day}` : ""} already has ${before.data!.length} rows`)
  }

  // The chat calls do not go through globalThis.fetch (the SDK binds its own),
  // so read usage off every completion the shared client returns.
  const { getOpenRouterClient } = await import("../functions/src/ai/openrouter.js")
  const completions = getOpenRouterClient().chat.completions as unknown as {
    create: (body: { model?: string }, opts?: unknown) => Promise<{ usage?: Record<string, any> }>
  }
  const originalCreate = completions.create.bind(completions)
  completions.create = async (body, opts) => {
    const res = await originalCreate(body, opts)
    record(body.model ?? "unknown", res?.usage)
    return res
  }

  const { generateWeekSync } = await import("../functions/src/ai/week-orchestrator.js")
  const { createDeadline } = await import("../functions/src/lib/deadline.js")
  const { MODEL_PROGRAM_ARCHITECT, MODEL_EXERCISE_SELECTOR } = await import("../functions/src/ai/anthropic.js")

  console.log(`\n=== REPLAY ${label} — ${MODEL_PROGRAM_ARCHITECT} / ${MODEL_EXERCISE_SELECTOR} ===`)
  const started = Date.now()
  let result: Awaited<ReturnType<typeof generateWeekSync>> | null = null
  let failure: string | null = null
  try {
    result = await generateWeekSync(
      {
        program_id: programId,
        client_id: clientId,
        assignment_id: assignmentId,
        target_week_number: week,
        ...(day !== undefined ? { target_day_of_week: day } : {}),
        admin_instructions: instructions,
        ...(Array.isArray(prod.pool_exercise_ids) ? { pool_exercise_ids: prod.pool_exercise_ids as string[] } : {}),
        ...(prod.pool_mode ? { pool_mode: prod.pool_mode as "preferred" | "strict" } : {}),
      },
      clientId,
      undefined,
      createDeadline(450_000, `replay:${label}`),
    )
  } catch (e) {
    failure = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
  }
  const seconds = (Date.now() - started) / 1000

  // Let the usage readers finish before pricing.
  await new Promise((r) => setTimeout(r, 1500))
  const prices = await priceList()
  let estimate = 0
  let reported = 0
  const perModel: Record<string, Usage & { est_cost: number }> = {}
  for (const [model, u] of usage) {
    const p = prices.get(model) ?? { prompt: 0, completion: 0, cache_read: 0 }
    const est = (u.prompt - u.cached) * p.prompt + u.cached * p.cache_read + u.completion * p.completion
    estimate += est
    reported += u.reported_cost
    perModel[model] = { ...u, est_cost: Number(est.toFixed(4)) }
  }

  // Clean up exactly what this run wrote.
  const after = await scope()
  const ids = (after.data ?? []).map((r: { id: string }) => r.id)
  if (ids.length > 0) {
    const del = await supabase.from("program_exercises").delete().in("id", ids)
    if (del.error) console.error("CLEANUP FAILED — delete these rows by hand:", ids, del.error)
  }

  const check = result?.instruction_check
  const summary = {
    label,
    job: jobId,
    architect: MODEL_PROGRAM_ARCHITECT,
    selector: MODEL_EXERCISE_SELECTOR,
    seconds: Number(seconds.toFixed(1)),
    failure,
    exercises_added: result?.exercises_added ?? 0,
    check_status: check?.status ?? null,
    rebuilt: check?.rebuilt ?? null,
    items: check?.items.length ?? 0,
    unmet: check?.items.filter((i) => !i.met).length ?? 0,
    unmet_lines: check?.items.filter((i) => !i.met).map((i) => `${i.instruction}: ${i.detail}`) ?? [],
    warnings: result?.warnings ?? [],
    est_cost_usd: Number(estimate.toFixed(4)),
    reported_cost_usd: Number(reported.toFixed(4)),
    per_model: perModel,
    cleaned_rows: ids.length,
  }
  appendFileSync(out, JSON.stringify(summary) + "\n")

  console.log(`  ${failure ? `FAILED: ${failure}` : `${summary.exercises_added} exercises`} in ${summary.seconds}s`)
  console.log(`  check: ${summary.check_status} (rebuilt=${summary.rebuilt}) — ${summary.unmet} of ${summary.items} not met`)
  for (const l of summary.unmet_lines) console.log(`    ✗ ${l}`)
  for (const it of check?.items.filter((i) => i.met) ?? []) console.log(`    ✓ ${it.instruction}: ${it.detail}`)
  console.log(`  warnings: ${summary.warnings.length}`)
  for (const w of summary.warnings) console.log(`    - ${w}`)
  console.log(`  cost: ~$${summary.est_cost_usd} (OpenRouter-reported $${summary.reported_cost_usd})`)
  for (const [m, u] of Object.entries(perModel))
    console.log(`    ${m}: ${u.calls} calls, ${u.prompt} in (${u.cached} cached) / ${u.completion} out ≈ $${u.est_cost}`)
  console.log(`  cleaned ${ids.length} rows`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
