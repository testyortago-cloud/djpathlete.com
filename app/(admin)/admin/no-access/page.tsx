import Link from "next/link"
import { Lock } from "lucide-react"
import { currentActor } from "@/lib/permissions/guard"
import { staffHomePath, describePermissions, NO_ACCESS_PATH } from "@/lib/permissions/registry"

export const metadata = { title: "No access" }

/**
 * A gate that silently bounces someone reads as a broken app. This page says
 * what happened, what they *do* have, and who to ask.
 */
export default async function NoAccessPage() {
  const actor = await currentActor()
  const permissions = actor?.permissions ?? {}
  const home = staffHomePath(permissions)
  const hasSomething = home !== NO_ACCESS_PATH

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-6 py-24 text-center">
      <div className="mb-6 flex size-14 items-center justify-center rounded-full bg-muted">
        <Lock className="size-6 text-muted-foreground" strokeWidth={1.5} />
      </div>

      <h1 className="font-heading text-2xl font-semibold">That area isn&apos;t part of your access</h1>

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {hasSomething
          ? "Your account is set up for a specific set of areas. If you need this one, ask Darren to add it."
          : "Your account doesn't have any areas assigned yet. Ask Darren to set up your access."}
      </p>

      <div className="mt-8 w-full rounded-lg border bg-card p-4 text-left">
        <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          What you can reach
        </p>
        <p className="mt-2 text-sm">{describePermissions(permissions)}</p>
      </div>

      {hasSomething && (
        <Link
          href={home}
          className="mt-8 inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Go to my dashboard
        </Link>
      )}
    </div>
  )
}
