import Image from "next/image"

/** Closing brand band — the card is a marketing surface every time it's shared. */
export function FooterCta() {
  return (
    <footer className="relative mt-16 overflow-hidden bg-primary py-10 text-center text-primary-foreground">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: "radial-gradient(circle at top right, oklch(0.70 0.08 60 / 0.18), transparent 45%)",
        }}
      />
      <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-3 px-4">
        <Image src="/logos/logo-icon-light.png" alt="DJP Athlete" width={44} height={44} className="h-11 w-auto" />
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-accent">DJP Athlete</p>
        <a
          href="https://www.darrenjpaul.com/"
          className="text-sm text-primary-foreground/80 underline-offset-4 transition-colors hover:text-accent hover:underline"
        >
          Train with Darren J Paul → darrenjpaul.com
        </a>
      </div>
    </footer>
  )
}
