import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { auth } from "@/lib/auth"
import { getAthleteProfileData } from "@/lib/profile-share/data"
import { AthleteProfileCard } from "@/components/admin/arena/AthleteProfileCard"

export const dynamic = "force-dynamic"

/**
 * The Arena card, admin-only. It used to be the public share page; the public
 * link now serves the test report, and this stays as the coach's own full view
 * (training volume, streaks, badges, program) which is deliberately NOT in the
 * client-facing report.
 *
 * Middleware already gates /admin/*; the role check here is defence in depth so
 * the page cannot be reached if the matcher ever changes.
 */
export default async function AdminClientArenaPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login?callbackUrl=/admin/clients")
  if (session.user.role !== "admin") notFound()

  const { id } = await params
  const data = await getAthleteProfileData(id)
  if (!data) notFound()

  return (
    <>
      <div className="px-4 pt-4 print:hidden">
        <Link
          href={`/admin/clients/${id}`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to client
        </Link>
      </div>
      <AthleteProfileCard data={data} />
    </>
  )
}
