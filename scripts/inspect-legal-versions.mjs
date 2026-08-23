/**
 * Prints the stored versions of a legal document so an existing draft is never
 * silently published over.
 *
 *   node scripts/inspect-legal-versions.mjs .env.prod privacy_policy
 */
import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

const [envPath, docType = "privacy_policy"] = process.argv.slice(2)
const env = {}
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data, error } = await sb
  .from("legal_documents")
  .select("*")
  .eq("document_type", docType)
  .order("version", { ascending: false })
if (error) {
  console.error(error.message)
  process.exit(1)
}

const A2P = [
  ["STOP", /Reply STOP|\bSTOP\b/],
  ["HELP", /Reply HELP|\bHELP\b/],
  ["frequency", /[Mm]essage frequency/],
  ["rates", /[Mm]essage and data rates/],
  ["no-share mobile", /mobile information will (not )?be sold or shared|not be sold or shared/i],
  ["YORTAGO", /YORTAGO/],
]

for (const d of data) {
  console.log("=".repeat(72))
  console.log(`v${d.version}  active=${d.is_active}  effective=${d.effective_date}  id=${d.id}`)
  console.log(`created=${d.created_at ?? "?"}  updated=${d.updated_at ?? "?"}  chars=${d.content.length}`)
  console.log("A2P elements:", A2P.map(([n, re]) => `${n}:${re.test(d.content) ? "YES" : "no"}`).join("  "))
  const text = d.content
    .replace(/<(p|li|h1|h2|ul|hr)[^>]*>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
  console.log("--- first 6 lines ---")
  console.log(text.slice(0, 6).join("\n"))
  console.log("--- section headings ---")
  console.log(text.filter((l) => /^\d+\.\s/.test(l)).join(" | "))
}
