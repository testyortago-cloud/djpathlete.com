import type React from "react"
import Link from "next/link"
import Image from "next/image"

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* Left panel — dark hero */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-primary">
        {/* Subtle gradient overlay */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 20% 50%, rgba(196,155,122,0.15) 0%, transparent 70%), radial-gradient(ellipse at 80% 20%, rgba(255,255,255,0.05) 0%, transparent 60%)",
          }}
        />

        {/* Grid pattern for texture */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-between w-full p-12 xl:p-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/logos/logo-icon-light.png"
              alt="DJP Athlete"
              width={160}
              height={100}
              className="object-contain"
              style={{ height: 48, width: "auto" }}
              priority
            />
            <span className="font-heading font-semibold tracking-[0.2em] text-base uppercase text-white">
              Athlete
            </span>
          </Link>

          {/* Quote */}
          <div className="max-w-md">
            <blockquote>
              <p className="text-3xl xl:text-4xl font-semibold text-white leading-tight tracking-tight font-heading">
                Train like an elite.
                <br />
                Perform like a champion.
              </p>
              <p className="mt-6 text-base text-white/50 leading-relaxed">
                Personalized coaching, performance tracking, and nutrition
                guidance — everything you need to reach your full potential.
              </p>
            </blockquote>
          </div>

          {/* Bottom stats */}
          <div className="flex items-center gap-8">
            <div>
              <p className="text-2xl font-semibold text-white font-heading">
                500+
              </p>
              <p className="text-sm text-white/40">
                Athletes coached
              </p>
            </div>
            <div className="w-px h-10 bg-white/10" />
            <div>
              <p className="text-2xl font-semibold text-white font-heading">
                98%
              </p>
              <p className="text-sm text-white/40">
                Satisfaction rate
              </p>
            </div>
            <div className="w-px h-10 bg-white/10" />
            <div>
              <p className="text-2xl font-semibold text-white font-heading">
                12+
              </p>
              <p className="text-sm text-white/40">
                Sports covered
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex w-full lg:w-1/2 flex-col bg-white">
        {/* Mobile logo header */}
        <header className="flex items-center justify-center py-8 lg:hidden">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/logos/logo-icon-dark.png"
              alt="DJP Athlete"
              width={160}
              height={100}
              className="object-contain"
              style={{ height: 44, width: "auto" }}
            />
            <span className="font-heading font-semibold tracking-[0.2em] text-sm uppercase text-foreground">
              Athlete
            </span>
          </Link>
        </header>

        {/* Centered form content */}
        <main className="flex flex-1 flex-col items-center justify-center px-6 sm:px-12 lg:px-16 xl:px-24 pb-8">
          <div className="w-full max-w-[420px]">{children}</div>
        </main>

        {/* Footer */}
        <footer className="py-6 text-center">
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} DJP Athlete. All rights reserved.
          </p>
        </footer>
      </div>
    </div>
  )
}
