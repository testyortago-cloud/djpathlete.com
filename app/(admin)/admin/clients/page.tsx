import { ClientList } from "@/components/admin/ClientList"

export const metadata = { title: "Clients" }

export default function ClientsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-6">Clients</h1>
      <ClientList />
    </div>
  )
}
