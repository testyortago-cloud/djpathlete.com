import { PersonalCheckinClient } from "@/components/checkin/PersonalCheckinClient"

export const metadata = { title: "Check in", robots: { index: false, follow: false } }

export default async function PersonalCheckinPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams

  return (
    <main className="min-h-screen flex items-center justify-center bg-surface px-4 py-12">
      <div className="w-full max-w-md">
        <PersonalCheckinClient token={token ?? ""} />
      </div>
    </main>
  )
}
