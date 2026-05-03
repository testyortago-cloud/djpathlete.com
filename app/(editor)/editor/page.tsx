export const metadata = { title: "Editor Dashboard" }

export default function EditorDashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-2xl text-primary">Welcome</h2>
        <p className="font-body text-sm text-muted-foreground">
          Your video upload and review workspace will appear here.
        </p>
      </div>
      <div className="rounded-md border border-dashed bg-muted/40 p-12 text-center">
        <p className="font-body text-sm text-muted-foreground">
          Video workflow coming soon.
        </p>
      </div>
    </div>
  )
}
