import { createServiceRoleClient } from "@/lib/supabase"
import { ConsentLogTable } from "./ConsentLogTable"

export const metadata = { title: "Marketing Consent Log" }

export default async function ConsentLogPage() {
  const supabase = createServiceRoleClient()
  const { data: rows } = await supabase
    .from("marketing_consent_log")
    .select("*, users!marketing_consent_log_user_id_fkey(email)")
    .order("created_at", { ascending: false })
    .limit(200)

  const flat = (rows ?? []).map((r) => ({
    ...r,
    user_email: (r.users as { email?: string } | null)?.email ?? null,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading text-primary">Marketing Consent Log</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Audit trail of every marketing-consent grant or revocation. Source identifies where the
          event came from (newsletter signup, account settings, etc.). Used as evidence for Google
          Ads Customer Match opt-in compliance.
        </p>
      </div>
      <ConsentLogTable rows={flat} />
    </div>
  )
}
