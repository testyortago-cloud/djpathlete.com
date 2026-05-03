import { getInviteByToken, inviteStatus } from "@/lib/db/team-invites"
import { InviteClaimForm } from "@/components/auth/InviteClaimForm"
import Link from "next/link"

export const metadata = { title: "Accept Invitation" }

interface Props {
  params: Promise<{ token: string }>
}

export default async function InviteClaimPage({ params }: Props) {
  const { token } = await params
  const invite = await getInviteByToken(token)

  if (!invite) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-8 text-center">
        <h1 className="font-heading text-xl text-primary">Invitation unavailable</h1>
        <p className="font-body text-sm text-muted-foreground">
          This invite link is no longer valid. Ask Darren to send a new one.
        </p>
        <Link href="/login" className="text-sm underline">Return to login</Link>
      </div>
    )
  }

  const status = inviteStatus(invite)

  if (status === "accepted") {
    return (
      <div className="mx-auto max-w-md space-y-4 p-8 text-center">
        <h1 className="font-heading text-xl text-primary">You've already accepted this invite</h1>
        <p className="font-body text-sm text-muted-foreground">
          Your account is set up. Sign in to access your editor workspace.
        </p>
        <Link href="/login" className="text-sm underline">Go to sign in</Link>
      </div>
    )
  }

  if (status === "expired") {
    return (
      <div className="mx-auto max-w-md space-y-4 p-8 text-center">
        <h1 className="font-heading text-xl text-primary">This invitation has expired</h1>
        <p className="font-body text-sm text-muted-foreground">
          Ask Darren to send a new invite link.
        </p>
        <Link href="/login" className="text-sm underline">Return to login</Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md space-y-6 p-8">
      <div className="space-y-2">
        <h1 className="font-heading text-2xl text-primary">Welcome to DJP Athlete</h1>
        <p className="font-body text-sm text-muted-foreground">
          You're joining as a <strong>video editor</strong>. Set your name and password below.
        </p>
        <p className="font-mono text-xs text-muted-foreground">{invite.email}</p>
      </div>
      <InviteClaimForm token={token} email={invite.email} />
    </div>
  )
}
