import { GraduationCap } from "lucide-react"
import { getStepUpPageContent } from "@/lib/db/step-up-page"
import { StepUpEditor } from "./StepUpEditor"

export const metadata = { title: "Step Up packages — DJP Athlete" }
export const dynamic = "force-dynamic"

export default async function StepUpAdminPage() {
  const content = await getStepUpPageContent()

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="size-12 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <GraduationCap className="size-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-heading text-primary">Step Up packages</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Edit the &quot;Packages&quot; section on the public{" "}
            <span className="font-mono">/step-up-for-students</span> page — the section heading,
            intro, and each package card. Add, remove, or re-order packages. Changes go live as soon
            as you save.
          </p>
        </div>
      </div>

      <StepUpEditor initialContent={content} />
    </div>
  )
}
