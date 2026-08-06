import { ImageResponse } from "next/og"
import { verifyAthleteProfileToken } from "@/lib/profile-share/token"
import { getTestReportData } from "@/lib/test-report/data"
import { buildReportScores } from "@/lib/test-report/scoring"

export const dynamic = "force-dynamic"

export const size = { width: 1200, height: 630 }
export const contentType = "image/png"
export const alt = "DJP Athlete Test Report"

// OG images render outside the CSS system — inline styles + brand hex are the
// established exception zone. Default sans (no remote font fetch) keeps
// unfurls reliable in messaging apps.
const ARENA = "#0B2E3B"
const ACCENT = "#C49B7A"
const ICE = "#D8E6EB"

export default async function OgImage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  let data = null
  try {
    const v = verifyAthleteProfileToken(token)
    if (v.valid) data = await getTestReportData(v.clientUserId)
  } catch {
    data = null
  }
  const scores = data ? buildReportScores(data.tests) : null

  // `|| fallback` also covers a client whose name fields are blank/whitespace.
  const name = (data ? `${data.name.first} ${data.name.last}`.trim().toUpperCase() : "") || "DJP ATHLETE"
  const initials =
    (data ? `${data.name.first.trim().charAt(0)}${data.name.last.trim().charAt(0)}`.toUpperCase() : "") || "DJP"
  const subtitle = data
    ? [data.sport, data.position].filter(Boolean).join(" · ") || "Performance Test Report"
    : "Elite Sports Performance Coaching"
  const specs = data ? [data.age !== null ? `AGE ${data.age}` : null].filter(Boolean) : []
  // Testing-only stats: the unfurl mirrors what the report itself leads with.
  const stats = data
    ? [
        { v: scores?.athleteScore !== null && scores ? `${scores.athleteScore}` : "0", l: "ATHLETE SCORE" },
        { v: String(data.testCount), l: "TESTS" },
        { v: String(data.prCount), l: "PRS" },
      ].filter((s) => s.v !== "0")
    : []

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          backgroundColor: ARENA,
          backgroundImage: `radial-gradient(ellipse 55% 45% at 88% 0%, ${ACCENT}52, transparent 60%), radial-gradient(ellipse 45% 35% at 0% 100%, ${ICE}24, transparent 60%)`,
          color: "#f2f6f7",
          fontFamily: "sans-serif",
        }}
      >
        {/* Inset hairline frame */}
        <div
          style={{
            display: "flex",
            position: "absolute",
            top: 28,
            left: 28,
            right: 28,
            bottom: 28,
            border: `1px solid ${ACCENT}55`,
            borderRadius: 18,
          }}
        />
        {/* Giant initials watermark */}
        <div
          style={{
            display: "flex",
            position: "absolute",
            right: -20,
            top: 40,
            fontSize: 430,
            fontWeight: 700,
            letterSpacing: -20,
            color: "#ffffff0d",
          }}
        >
          {initials}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", width: 44, height: 2, backgroundColor: ACCENT }} />
          <div style={{ display: "flex", fontSize: 26, letterSpacing: 6, color: ACCENT }}>
            DJP ATHLETE TEST REPORT
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", fontSize: 88, fontWeight: 700, lineHeight: 1.02, letterSpacing: -2 }}>
            {name}
          </div>
          <div style={{ display: "flex", fontSize: 32, color: "#ffffffbb" }}>{subtitle}</div>
          {specs.length > 0 && (
            <div style={{ display: "flex", gap: 28, fontSize: 22, letterSpacing: 3, color: ICE }}>
              {specs.map((s) => (
                <div key={s as string} style={{ display: "flex" }}>
                  {s}
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", gap: 44 }}>
            {stats.map((s) => (
              <div key={s.l} style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", fontSize: 52, fontWeight: 700, color: ACCENT }}>{s.v}</div>
                <div style={{ display: "flex", fontSize: 20, letterSpacing: 3, color: "#ffffff99" }}>{s.l}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", fontSize: 24, color: "#ffffff99" }}>darrenjpaul.com</div>
        </div>
      </div>
    ),
    size,
  )
}
