import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { CalendarDays, MapPin, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { getEventBySlug } from "@/lib/db/events"
import { getEventSignupByStripeSessionId } from "@/lib/db/event-signups"

export const metadata: Metadata = {
  title: "Booking confirmed",
  robots: { index: false, follow: false },
}

interface PageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ session_id?: string }>
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

export default async function ClinicBookingSuccessPage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const { session_id } = await searchParams

  const event = await getEventBySlug(slug)
  if (!event || event.type !== "clinic") notFound()

  const signup = session_id ? await getEventSignupByStripeSessionId(session_id) : null

  return (
    <div className="bg-surface min-h-[calc(100vh-80px)] py-12 md:py-20">
      <div className="mx-auto max-w-3xl px-4 md:px-6">
        <Card className="rounded-3xl border-border bg-background">
          <CardContent className="p-8 text-center md:p-12">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success">
              <CheckCircle2 className="h-7 w-7" />
            </div>

            <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
              You&rsquo;re in.
            </h1>

            {signup ? (
              <>
                <p className="mt-3 text-lg text-muted-foreground">
                  {signup.athlete_name} is booked for {event.title}.
                </p>

                <div className="mt-8 grid gap-3 text-left">
                  <div className="flex items-center gap-3 rounded-xl border border-border p-4">
                    <CalendarDays className="h-5 w-5 flex-shrink-0 text-primary" />
                    <span className="text-sm">{formatDate(event.start_date)}</span>
                  </div>
                  <div className="flex items-start gap-3 rounded-xl border border-border p-4">
                    <MapPin className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                    <div className="text-sm">
                      <div>{event.location_name}</div>
                      {event.location_address && (
                        <div className="mt-0.5 text-muted-foreground">{event.location_address}</div>
                      )}
                    </div>
                  </div>
                </div>

                {signup.status === "confirmed" && (
                  <p className="mt-6 text-sm text-muted-foreground">
                    A confirmation email is on its way to {signup.parent_email}.
                  </p>
                )}
                {signup.status === "pending" && (
                  <div className="mt-6 rounded-xl border border-accent/30 bg-accent/10 p-4 text-sm text-foreground">
                    We&rsquo;re still processing your payment — this usually finishes within a few seconds. You&rsquo;ll
                    receive a confirmation email shortly. You can refresh this page to check the latest status.
                  </div>
                )}
                {(signup.status === "cancelled" || signup.status === "refunded") && (
                  <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-foreground">
                    This booking has been {signup.status} — please contact Darren if this is unexpected.
                  </div>
                )}
              </>
            ) : (
              <p className="mt-3 text-lg text-muted-foreground">
                Payment received. Check your email for a confirmation within a few minutes.
              </p>
            )}

            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Button asChild variant="outline">
                <Link href="/clinics">Browse more clinics</Link>
              </Button>
              <Button asChild>
                <Link href="/">Back to home</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
