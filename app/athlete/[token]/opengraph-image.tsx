import { ImageResponse } from "next/og"
import { verifyAthleteProfileToken } from "@/lib/profile-share/token"
import { clientProfileShareEnabled } from "@/lib/profile-share/flags"
import { getAthleteProfileData } from "@/lib/profile-share/data"

export const size = { width: 1200, height: 630 }
export const contentType = "image/png"
export const alt = "DJP Athlete Profile"

// OG images render outside the CSS system — inline styles + brand hex are the
// established exception zone. Default sans (no remote font fetch) keeps
// unfurls reliable in messaging apps.
const PRIMARY = "#0E3F50"
const ACCENT = "#C49B7A"

export default async function OgImage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  let data = null
  try {
    if (await clientProfileShareEnabled()) {
      const v = verifyAthleteProfileToken(token)
      if (v.valid) data = await getAthleteProfileData(v.clientUserId)
    }
  } catch {
    data = null
  }

  const name = data ? `${data.name.first} ${data.name.last}`.trim().toUpperCase() : "DJP ATHLETE"
  const subtitle = data
    ? [data.sport, data.position].filter(Boolean).join(" · ") || "Athlete Profile"
    : "Elite Sports Performance Coaching"
  const stats = data
    ? [
        { v: String(data.stats.workouts), l: "WORKOUTS" },
        { v: String(data.stats.prCount), l: "PRS" },
        { v: `${data.stats.streakDays}D`, l: "STREAK" },
      ].filter((s) => s.v !== "0" && s.v !== "0D")
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
          padding: 64,
          backgroundColor: PRIMARY,
          backgroundImage: `radial-gradient(ellipse 55% 45% at 88% 0%, ${ACCENT}55, transparent 60%), radial-gradient(ellipse 45% 35% at 0% 100%, ${ACCENT}2e, transparent 60%)`,
          color: "#f2f6f7",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", width: 44, height: 2, backgroundColor: ACCENT }} />
          <div style={{ display: "flex", fontSize: 28, letterSpacing: 6, color: ACCENT }}>DJP ATHLETE PROFILE</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", fontSize: 84, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>
            {name}
          </div>
          <div style={{ display: "flex", fontSize: 34, color: "#ffffffbb" }}>{subtitle}</div>
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
