import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { getUserById } from "@/lib/db/users"
import { ChangePasswordForm } from "@/components/editor/ChangePasswordForm"
import { Mail, User as UserIcon, Shield, Calendar } from "lucide-react"

export const metadata = { title: "Settings" }

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export default async function EditorSettingsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login?callbackUrl=/editor/settings")

  const user = await getUserById(session.user.id)
  const fullName = `${user.first_name} ${user.last_name}`.trim() || "Editor"
  const initials = `${user.first_name.charAt(0)}${user.last_name.charAt(0)}`.toUpperCase() || "E"

  return (
    <div className="space-y-8">
      <header className="border-b border-border pb-4 space-y-1">
        <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
          Account · Settings
        </p>
        <h1 className="font-heading text-2xl text-primary">Settings</h1>
        <p className="font-body text-sm text-muted-foreground">
          Your studio identity and account credentials.
        </p>
      </header>

      {/* Profile plate — read-only "studio identity card" */}
      <section
        aria-labelledby="profile-heading"
        className="rounded-md border bg-card overflow-hidden"
      >
        <div className="flex items-start gap-5 border-b border-border bg-muted/20 px-6 py-5">
          <div
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground font-heading text-xl tracking-wide"
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <h2 id="profile-heading" className="font-heading text-lg text-primary truncate">
              {fullName}
            </h2>
            <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
              {user.role === "admin" ? "Admin · Editor view" : "Editor"}
              {" · "}
              ID {user.id.slice(0, 8)}
            </p>
          </div>
        </div>

        <dl className="divide-y divide-border">
          <ProfileRow icon={<UserIcon className="size-4" />} label="Display name" value={fullName} />
          <ProfileRow icon={<Mail className="size-4" />} label="Email" value={user.email} mono />
          <ProfileRow
            icon={<Shield className="size-4" />}
            label="Role"
            value={user.role}
            mono
            valueClassName="capitalize"
          />
          <ProfileRow
            icon={<Calendar className="size-4" />}
            label="Member since"
            value={shortDate(user.created_at)}
          />
        </dl>

        <div className="border-t border-border bg-muted/20 px-6 py-3">
          <p className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
            Profile fields are read-only. Ask Darren to update name or email.
          </p>
        </div>
      </section>

      {/* Password card */}
      <section
        aria-labelledby="password-heading"
        className="rounded-md border bg-card"
      >
        <header className="border-b border-border px-6 py-4 space-y-1">
          <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground">
            Credentials
          </p>
          <h2 id="password-heading" className="font-heading text-lg text-primary">
            Change password
          </h2>
          <p className="font-body text-sm text-muted-foreground">
            You&apos;ll stay signed in on this device after updating.
          </p>
        </header>
        <div className="px-6 py-5">
          <ChangePasswordForm />
        </div>
      </section>
    </div>
  )
}

function ProfileRow({
  icon,
  label,
  value,
  mono,
  valueClassName,
}: {
  icon: React.ReactNode
  label: string
  value: string
  mono?: boolean
  valueClassName?: string
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-6 py-3.5">
      <dt className="flex items-center gap-2 text-sm text-muted-foreground">
        <span aria-hidden className="text-muted-foreground/70">
          {icon}
        </span>
        {label}
      </dt>
      <dd
        className={`text-sm text-primary text-right truncate max-w-[60%] ${mono ? "font-mono text-xs" : ""} ${valueClassName ?? ""}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  )
}
