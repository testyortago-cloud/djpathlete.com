import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { listFavoritesByClient } from "@/lib/db/exercise-favorites"
import { MyFavoritesList } from "@/components/client/MyFavoritesList"

export const metadata = { title: "Favorite Exercises | DJP Athlete" }

export default async function FavoritesPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const userId = session.user.id

  let favorites: Awaited<ReturnType<typeof listFavoritesByClient>> = []
  try {
    favorites = await listFavoritesByClient(userId)
  } catch {
    // DB tables may not exist yet — render gracefully with empty list
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="mb-1 font-heading text-2xl text-primary">Favorite Exercises</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Exercises you love. Your coach&apos;s AI uses these to shape your future programs.
      </p>
      <MyFavoritesList favorites={favorites} />
    </div>
  )
}
