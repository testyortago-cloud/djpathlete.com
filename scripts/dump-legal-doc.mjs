/**
 * Read-only. Writes the ACTIVE version of a legal document to a file so its exact
 * HTML can be inspected before anything is built on top of it.
 *
 *   node scripts/dump-legal-doc.mjs .env.prod terms_of_service /tmp/terms.html
 */
import { readFileSync, writeFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

const [envPath, docType, outPath] = process.argv.slice(2)
if (!envPath || !docType || !outPath) {
  console.error("usage: node scripts/dump-legal-doc.mjs <env-file> <document_type> <out-file>")
  process.exit(1)
}

const env = {}
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const { data, error } = await sb
  .from("legal_documents")
  .select("id,version,effective_date,title,content")
  .eq("document_type", docType)
  .eq("is_active", true)
  .single()

if (error) {
  console.error("read failed:", error.message)
  process.exit(1)
}

writeFileSync(outPath, data.content)
console.log(`active v${data.version}  id=${data.id}  effective=${data.effective_date}  title=${JSON.stringify(data.title)}`)
console.log(`wrote ${data.content.length} chars to ${outPath}`)
