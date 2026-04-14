import { createClient } from "@supabase/supabase-js"
import * as dotenv from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: resolve(__dirname, "../.env.local") })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function check() {
  const { data, error } = await supabase
    .from("users")
    .select("id, email, first_name, last_name, role, status")
    .order("created_at")

  if (error) {
    console.error(error.message)
    return
  }

  console.log(`Total users: ${data.length}\n`)
  data.forEach((u) => console.log(`  ${u.email} | ${u.first_name} ${u.last_name} | ${u.role} | ${u.id}`))
}

check()
