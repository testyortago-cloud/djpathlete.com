import { cache } from "react"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { verifyAthleteProfileToken } from "@/lib/profile-share/token"
import { clientProfileShareEnabled } from "@/lib/profile-share/flags"
import { getAthleteProfileData, type AthleteProfileData } from "@/lib/profile-share/data"
import { AthleteProfileCard } from "@/components/public/athlete/AthleteProfileCard"

export const dynamic = "force-dynamic"

// cache() dedupes the assembly between generateMetadata and the page render.
const resolveData = cache(async (token: string): Promise<AthleteProfileData | null> => {
  if (!(await clientProfileShareEnabled())) return null
  const v = verifyAthleteProfileToken(token)
  if (!v.valid) return null
  return getAthleteProfileData(v.clientUserId)
})

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>
}): Promise<Metadata> {
  const { token } = await params
  const data = await resolveData(token)
  const robots = { index: false, follow: false }
  if (!data) return { title: "Athlete Profile", robots }
  const name = `${data.name.first} ${data.name.last}`.trim()
  const description = [data.sport, data.position].filter(Boolean).join(" · ") || "Training with DJP Athlete"
  return {
    title: `${name} — Athlete Profile`,
    description,
    robots,
    openGraph: { title: `${name} — DJP Athlete Profile`, description, type: "profile" },
    twitter: { card: "summary_large_image", title: `${name} — DJP Athlete Profile`, description },
  }
}

export default async function AthleteProfilePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const data = await resolveData(token)
  if (!data) notFound()
  return <AthleteProfileCard data={data} />
}
