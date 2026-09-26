import type { CSSProperties, ReactNode } from "react"
import type { BusinessPageIdentity } from "@/lib/lead-engine/business-page"

/**
 * The page around the unsubscribe and "can we text you?" answers (G49): the
 * business that sent the email, laid out like its sequence emails
 * (lib/lead-engine/email.ts) — a band in its brand colour carrying its logo or
 * its name, an accent strip, and "Sent by … · address" at the foot.
 *
 * It re-themes everything inside it by overriding `--primary` and
 * `--primary-foreground` on its root. Tailwind's `text-primary` / `bg-primary`
 * read those variables (`@theme inline` in app/globals.css), so the pages'
 * headings and the "I agree" button take the business's colours without
 * either page knowing a colour.
 *
 * With no identity (no name, or settings that could not be read) it shows the
 * content alone: never the platform's name, never another business's.
 */
export function BusinessFrame({ identity, children }: { identity: BusinessPageIdentity | null; children: ReactNode }) {
  if (!identity) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-16">
        <div className="w-full max-w-md">{children}</div>
      </div>
    )
  }

  const { palette } = identity
  const theme = { "--primary": palette.brand, "--primary-foreground": palette.brandInk } as CSSProperties

  return (
    <div className="flex min-h-screen flex-col bg-surface" style={theme}>
      <header style={{ background: palette.brand }}>
        <div className="mx-auto max-w-xl px-4 py-7 text-center">
          {identity.logoUrl ? (
            // A coach's own logo from their settings, on any host they chose:
            // next/image would need every such host allow-listed in advance.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={identity.logoUrl} alt={identity.displayName} className="mx-auto max-h-12" />
          ) : (
            <p className="font-heading text-base uppercase tracking-[0.3em]" style={{ color: palette.brandInk }}>
              {identity.displayName}
            </p>
          )}
        </div>
        <div aria-hidden="true" className="h-1" style={{ background: palette.strip }} />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-xl border border-border bg-white p-6 shadow-sm sm:p-8">{children}</div>
      </main>

      <footer className="px-4 pb-10 text-center">
        <p className="font-heading mb-1 text-[10px] uppercase tracking-[0.25em]" style={{ color: palette.accent }}>
          {identity.displayName}
        </p>
        <p className="text-xs text-muted-foreground">
          {identity.postalAddress
            ? `Sent by ${identity.senderName} · ${identity.postalAddress}`
            : `Sent by ${identity.senderName}`}
        </p>
      </footer>
    </div>
  )
}
