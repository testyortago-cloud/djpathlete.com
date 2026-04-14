import { Users, UserPlus, UserCheck, ClipboardCheck } from "lucide-react"
import { getUsers } from "@/lib/db/users"
import { getAssignments } from "@/lib/db/assignments"
import { getAllProfiles } from "@/lib/db/client-profiles"
import { ClientList } from "@/components/admin/ClientList"
import { ClientsPageHeader } from "./ClientsPageHeader"
import type { User, ProgramAssignment } from "@/types/database"

export const metadata = { title: "Clients" }

export default async function ClientsPage() {
  const [users, assignments, profiles] = await Promise.all([getUsers(), getAssignments(), getAllProfiles()])

  const clients = (users as User[]).filter((u) => u.role === "client")
  const totalClients = clients.length

  // New this month
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const newThisMonth = clients.filter((u) => new Date(u.created_at) >= monthStart).length

  // Active (on a program)
  const activeUserIds = new Set(
    (assignments as ProgramAssignment[]).filter((a) => a.status === "active").map((a) => a.user_id),
  )
  const activeOnProgram = activeUserIds.size

  // Profile completion
  const profilesWithGoals = profiles.filter((p) => p.goals)
  const profileCompletion = totalClients > 0 ? Math.round((profilesWithGoals.length / totalClients) * 100) : 0

  return (
    <div>
      <ClientsPageHeader />

      {/* Summary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <div className="bg-white rounded-xl border border-border p-3 sm:p-4">
          <div className="flex items-center gap-2 sm:gap-3 mb-1.5">
            <div className="flex size-8 sm:size-9 items-center justify-center rounded-lg bg-primary/10">
              <Users className="size-3.5 sm:size-4 text-primary" />
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">Total Clients</p>
          </div>
          <p className="text-xl sm:text-2xl font-semibold text-primary">{totalClients}</p>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4">
          <div className="flex items-center gap-2 sm:gap-3 mb-1.5">
            <div className="flex size-8 sm:size-9 items-center justify-center rounded-lg bg-success/10">
              <UserPlus className="size-3.5 sm:size-4 text-success" />
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">New This Month</p>
          </div>
          <p className="text-xl sm:text-2xl font-semibold text-primary">{newThisMonth}</p>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4">
          <div className="flex items-center gap-2 sm:gap-3 mb-1.5">
            <div className="flex size-8 sm:size-9 items-center justify-center rounded-lg bg-primary/10">
              <UserCheck className="size-3.5 sm:size-4 text-primary" />
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">On Program</p>
          </div>
          <p className="text-xl sm:text-2xl font-semibold text-primary">{activeOnProgram}</p>
        </div>

        <div className="bg-white rounded-xl border border-border p-3 sm:p-4">
          <div className="flex items-center gap-2 sm:gap-3 mb-1.5">
            <div className="flex size-8 sm:size-9 items-center justify-center rounded-lg bg-primary/10">
              <ClipboardCheck className="size-3.5 sm:size-4 text-primary" />
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">Profile Done</p>
          </div>
          <p className="text-xl sm:text-2xl font-semibold text-primary">{profileCompletion}%</p>
        </div>
      </div>

      <ClientList users={users} />
    </div>
  )
}
