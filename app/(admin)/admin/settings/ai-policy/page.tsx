import { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft, Brain, CheckCircle2, Ban, Sparkles } from "lucide-react"
import { auth } from "@/lib/auth"
import { getCoachPolicy } from "@/lib/db/coach-ai-policy"
import { AiPolicyForm } from "@/components/admin/ai-policy-form"
import { redirect } from "next/navigation"

export const metadata: Metadata = { title: "AI Program Policy — DJP Athlete Admin" }

export default async function AiPolicyPage() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") redirect("/login")
  const policy = await getCoachPolicy(session.user.id)

  const disallowedCount = policy?.disallowed_techniques?.length ?? 0
  const preferredCount = policy?.preferred_techniques?.length ?? 0
  const progressionOn = policy?.technique_progression_enabled ?? true
  const hasNotes = !!policy?.programming_notes?.trim()

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/admin/settings"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary mb-3"
        >
          <ArrowLeft className="size-4" />
          Back to Settings
        </Link>
        <div className="flex items-start gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 shrink-0">
            <Brain className="size-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-primary">AI Program Policy</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Control how the AI generates programs across all of your clients. These rules are injected into every
              program generation as coach instructions and override the AI&apos;s defaults.
            </p>
          </div>
        </div>
      </div>

      {/* Active policy summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
            <Ban className="size-3.5 sm:size-4 text-destructive" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Disallowed</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{disallowedCount}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-success/10">
            <CheckCircle2 className="size-3.5 sm:size-4 text-success" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Preferred</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{preferredCount}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div
            className={`flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg ${
              progressionOn ? "bg-primary/10" : "bg-muted"
            }`}
          >
            <Sparkles className={`size-3.5 sm:size-4 ${progressionOn ? "text-primary" : "text-muted-foreground"}`} />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Progression</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{progressionOn ? "On" : "Off"}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3">
          <div className="flex size-8 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-accent/15">
            <Brain className="size-3.5 sm:size-4 text-accent" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">Custom Notes</p>
            <p className="text-lg sm:text-2xl font-semibold text-primary">{hasNotes ? "Yes" : "—"}</p>
          </div>
        </div>
      </div>

      <AiPolicyForm initialPolicy={policy} />
    </div>
  )
}
