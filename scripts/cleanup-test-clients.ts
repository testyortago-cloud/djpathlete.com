import { createClient } from "@supabase/supabase-js"
import * as dotenv from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: resolve(__dirname, "../.env.local") })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const TEST_CLIENT_IDS = Array.from(
  { length: 10 },
  (_, i) => `20000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
)

async function cleanup() {
  console.log("Deleting test clients (test1-test10)...\n")

  // Delete program_assignments
  const { error: assignErr, count: assignCount } = await supabase
    .from("program_assignments")
    .delete({ count: "exact" })
    .in("user_id", TEST_CLIENT_IDS)

  console.log(
    assignErr
      ? `  program_assignments error: ${assignErr.message}`
      : `  Deleted ${assignCount ?? 0} program_assignments`,
  )

  // Delete client_profiles
  const { error: profileErr, count: profileCount } = await supabase
    .from("client_profiles")
    .delete({ count: "exact" })
    .in("user_id", TEST_CLIENT_IDS)

  console.log(
    profileErr ? `  client_profiles error: ${profileErr.message}` : `  Deleted ${profileCount ?? 0} client_profiles`,
  )

  // Delete assessment_results
  const { error: assessErr, count: assessCount } = await supabase
    .from("assessment_results")
    .delete({ count: "exact" })
    .in("user_id", TEST_CLIENT_IDS)

  console.log(
    assessErr ? `  assessment_results error: ${assessErr.message}` : `  Deleted ${assessCount ?? 0} assessment_results`,
  )

  // Delete the users
  const { error: userErr, count: userCount } = await supabase
    .from("users")
    .delete({ count: "exact" })
    .in("id", TEST_CLIENT_IDS)

  console.log(userErr ? `  users error: ${userErr.message}` : `  Deleted ${userCount ?? 0} users`)

  console.log("\nDone!")
}

cleanup()
