import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { listByUser } from "@/lib/db/athlete-goals"
import { LogGoalForm } from "@/components/client/profile/log-goal-form"
import { GoalsList } from "@/components/client/profile/goals-list"

export default async function ClientGoalsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login?callbackUrl=/client/goals")
  const goals = await listByUser(session.user.id)

  return (
    <div className="container max-w-3xl space-y-8 py-8">
      <h1 className="font-heading text-3xl font-bold">Goals</h1>
      <section>
        <h2 className="font-heading mb-4 text-xl font-semibold">All goals</h2>
        <GoalsList goals={goals} />
      </section>
      <section>
        <h2 className="font-heading mb-4 text-xl font-semibold">Add a new goal</h2>
        <LogGoalForm />
      </section>
    </div>
  )
}
