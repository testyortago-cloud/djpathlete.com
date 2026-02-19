import { getPrograms } from "@/lib/db/programs"
import { ProgramList } from "@/components/admin/ProgramList"

export const metadata = { title: "Programs" }

export default async function ProgramsPage() {
  const programs = await getPrograms()

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Programs</h1>
      <ProgramList programs={programs} />
    </div>
  )
}
