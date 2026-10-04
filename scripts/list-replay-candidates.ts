/**
 * Lists recent PROD week/day generation jobs and where each could be replayed
 * on the dev clone. Prints ids, dates, scope and instruction LENGTH only —
 * never the instruction text (that is a production read).
 *   npx tsx scripts/list-replay-candidates.ts [--limit 15]
 */
import { config } from "dotenv"
import path from "node:path"
config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true })
process.env.SUPABASE_URL ||= process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
if (!process.env.SUPABASE_URL.includes("anjvztjiokcgiyhobknq")) throw new Error("Refusing: not the dev clone")

async function main() {
  const limit = Number(process.argv[process.argv.indexOf("--limit") + 1]) || 15
  const { initializeApp, cert } = await import("firebase-admin/app")
  const { getFirestore } = await import("firebase-admin/firestore")
  const app = initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY ?? "{}")) }, "candidates")
  const snap = await getFirestore(app)
    .collection("ai_jobs")
    .where("type", "==", "week_generation")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get()
  const { getSupabase } = await import("../functions/src/lib/supabase.js")
  const supabase = getSupabase()
  for (const doc of snap.docs) {
    const req = (doc.data().input?.request ?? {}) as Record<string, unknown>
    const programId = String(req.program_id ?? "")
    const { data: rows } = await supabase.from("program_exercises").select("week_number").eq("program_id", programId)
    const { data: asg } = await supabase
      .from("program_assignments")
      .select("id, user_id")
      .eq("program_id", programId)
      .limit(1)
      .maybeSingle()
    const maxWeek = Math.max(0, ...(rows ?? []).map((r: { week_number: number }) => r.week_number))
    console.log(
      [
        doc.id,
        doc.data().createdAt?.toDate?.().toISOString?.() ?? "?",
        req.target_day_of_week ? `day ${req.target_day_of_week}` : "week",
        `instr ${String(req.admin_instructions ?? "").length} chars`,
        `pool ${Array.isArray(req.pool_exercise_ids) ? req.pool_exercise_ids.length : 0}`,
        rows ? `clone program ✓ (max week ${maxWeek}, replay week ${maxWeek + 1})` : "clone program ✗",
        asg ? `client ${asg.user_id} assignment ${asg.id}` : "no clone assignment",
      ].join(" | "),
    )
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
