import { cache } from "react"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { verifyAthleteProfileToken } from "@/lib/profile-share/token"
import { getTestReportData, type TestReportData } from "@/lib/test-report/data"
import { TestReport } from "@/components/public/report/TestReport"

export const dynamic = "force-dynamic"

// cache() dedupes the assembly between generateMetadata and the page render.
const resolveData = cache(async (token: string): Promise<TestReportData | null> => {
  const v = verifyAthleteProfileToken(token)
  if (!v.valid) return null
  return getTestReportData(v.clientUserId)
})

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>
}): Promise<Metadata> {
  const { token } = await params
  const data = await resolveData(token)
  const robots = { index: false, follow: false }
  if (!data) return { title: "Test Report", robots }
  const name = `${data.name.first} ${data.name.last}`.trim()
  const description = [data.sport, data.position].filter(Boolean).join(" · ") || "Performance testing with DJP Athlete"
  return {
    title: `${name} — Test Report`,
    description,
    robots,
    openGraph: { title: `${name} — DJP Athlete Test Report`, description, type: "profile" },
    twitter: { card: "summary_large_image", title: `${name} — DJP Athlete Test Report`, description },
  }
}

/**
 * The public athlete test report. The URL, token family and HMAC verification
 * are unchanged from when this route served the Arena card — every share link
 * already in the wild resolves here instead of breaking. The Arena card now
 * lives at /admin/clients/[id]/arena, admin-only.
 */
export default async function AthleteProfilePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const data = await resolveData(token)
  if (!data) notFound()
  return <TestReport data={data} />
}
