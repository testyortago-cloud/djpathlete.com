"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { businessSettingsPatchSchema, type BusinessSettingsPatch } from "@/lib/validators/business"
import { COMMON_TIMEZONES } from "@/lib/timezones"
import type { BusinessSettings } from "@/lib/db/businesses"

type FormValues = BusinessSettingsPatch

function toFormValues(settings: BusinessSettings): FormValues {
  return {
    display_name: settings.display_name ?? "",
    logo_url: settings.logo_url ?? "",
    sender_name: settings.sender_name ?? "",
    sender_email: settings.sender_email ?? "",
    reply_to: settings.reply_to ?? "",
    timezone: settings.timezone ?? "",
    quiet_hours_start: settings.quiet_hours_start,
    quiet_hours_end: settings.quiet_hours_end,
    daily_message_cap: settings.daily_message_cap,
    sms_help_text: settings.sms_help_text ?? "",
    sms_messaging_service_sid: settings.sms_messaging_service_sid ?? "",
    sms_sender_phone: settings.sms_sender_phone ?? "",
    postal_address: settings.postal_address ?? "",
  }
}

export function BusinessSettingsForm({
  businessId,
  settings,
}: {
  businessId: string
  settings: BusinessSettings
}) {
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(businessSettingsPatchSchema),
    defaultValues: toFormValues(settings),
  })

  const timezone = watch("timezone")

  async function onSubmit(data: FormValues) {
    setServerError(null)
    const res = await fetch(`/api/admin/businesses/${businessId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: data }),
    })

    if (res.ok) {
      const json = await res.json()
      reset(toFormValues(json.settings))
      toast.success("Settings saved")
      return
    }

    const json = await res.json().catch(() => ({}))
    setServerError(json.error ?? "Something went wrong. Please try again.")
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {serverError && (
        <div role="alert" className="rounded border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
          {serverError}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg text-primary">Identity</CardTitle>
          <CardDescription>How this business shows up to its own clients.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="display_name">Display name</Label>
            <Input
              id="display_name"
              aria-invalid={!!errors.display_name}
              {...register("display_name")}
            />
            {errors.display_name && <p className="text-xs text-error">{errors.display_name.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="logo_url">Logo web address</Label>
            <Input
              id="logo_url"
              aria-invalid={!!errors.logo_url}
              aria-describedby="logo_url-hint"
              {...register("logo_url")}
            />
            {errors.logo_url ? (
              <p className="text-xs text-error">{errors.logo_url.message}</p>
            ) : (
              <p id="logo_url-hint" className="text-xs text-muted-foreground">
                A link to this business&apos;s logo image. Can be left blank.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg text-primary">Email</CardTitle>
          <CardDescription>The name and addresses this business&apos;s emails come from.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sender_name">Sender name</Label>
            <Input id="sender_name" aria-invalid={!!errors.sender_name} {...register("sender_name")} />
            {errors.sender_name && <p className="text-xs text-error">{errors.sender_name.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sender_email">Sender email</Label>
            <Input
              id="sender_email"
              type="email"
              aria-invalid={!!errors.sender_email}
              {...register("sender_email")}
            />
            {errors.sender_email && <p className="text-xs text-error">{errors.sender_email.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reply_to">Reply-to email</Label>
            <Input id="reply_to" type="email" aria-invalid={!!errors.reply_to} {...register("reply_to")} />
            {errors.reply_to ? (
              <p className="text-xs text-error">{errors.reply_to.message}</p>
            ) : (
              <p className="text-xs text-muted-foreground">Where replies to this business&apos;s emails land.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg text-primary">Timing</CardTitle>
          <CardDescription>When this business sends messages and books calls.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="timezone">Time zone</Label>
            <Select
              value={timezone}
              onValueChange={(value) => setValue("timezone", value, { shouldValidate: true, shouldDirty: true })}
            >
              <SelectTrigger id="timezone" aria-invalid={!!errors.timezone} className="w-full">
                <SelectValue placeholder="Pick a time zone" />
              </SelectTrigger>
              <SelectContent>
                {COMMON_TIMEZONES.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>
                    {tz.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.timezone && <p className="text-xs text-error">{errors.timezone.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="quiet_hours_start">Quiet hours start</Label>
              <Input
                id="quiet_hours_start"
                type="number"
                min={0}
                max={23}
                aria-invalid={!!errors.quiet_hours_start}
                aria-describedby="quiet-hours-hint"
                {...register("quiet_hours_start", { valueAsNumber: true })}
              />
              {errors.quiet_hours_start && (
                <p className="text-xs text-error">{errors.quiet_hours_start.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quiet_hours_end">Quiet hours end</Label>
              <Input
                id="quiet_hours_end"
                type="number"
                min={0}
                max={23}
                aria-invalid={!!errors.quiet_hours_end}
                {...register("quiet_hours_end", { valueAsNumber: true })}
              />
              {errors.quiet_hours_end && <p className="text-xs text-error">{errors.quiet_hours_end.message}</p>}
            </div>
          </div>
          <p id="quiet-hours-hint" className="text-xs text-muted-foreground">
            No text messages go out to clients between these hours, in this business&apos;s own time zone.
            Use the hour of the day, from 0 (midnight) to 23 (11pm).
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="daily_message_cap">Daily message limit per client</Label>
            <Input
              id="daily_message_cap"
              type="number"
              min={1}
              max={50}
              aria-invalid={!!errors.daily_message_cap}
              aria-describedby="daily-cap-hint"
              {...register("daily_message_cap", { valueAsNumber: true })}
            />
            {errors.daily_message_cap ? (
              <p className="text-xs text-error">{errors.daily_message_cap.message}</p>
            ) : (
              <p id="daily-cap-hint" className="text-xs text-muted-foreground">
                The most text messages a single client can be sent in one day.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg text-primary">Text messages</CardTitle>
          <CardDescription>How this business&apos;s text messages identify themselves and opt out.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sms_help_text">Help text</Label>
            <Textarea id="sms_help_text" aria-invalid={!!errors.sms_help_text} {...register("sms_help_text")} />
            {errors.sms_help_text ? (
              <p className="text-xs text-error">{errors.sms_help_text.message}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Sent back when a client texts HELP. Should say who this is from and how to reach a person.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sms_messaging_service_sid">Messaging service ID</Label>
            <Input
              id="sms_messaging_service_sid"
              aria-invalid={!!errors.sms_messaging_service_sid}
              aria-describedby="sms-messaging-service-sid-hint"
              {...register("sms_messaging_service_sid")}
            />
            {errors.sms_messaging_service_sid ? (
              <p className="text-xs text-error">{errors.sms_messaging_service_sid.message}</p>
            ) : (
              <p id="sms-messaging-service-sid-hint" className="text-xs text-muted-foreground">
                Identifies this business&apos;s text messages to the carrier network. Comes from your text
                messaging provider when this business is set up to send texts.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sms_sender_phone">Sender phone number</Label>
            <Input
              id="sms_sender_phone"
              aria-invalid={!!errors.sms_sender_phone}
              {...register("sms_sender_phone")}
            />
            {errors.sms_sender_phone && <p className="text-xs text-error">{errors.sms_sender_phone.message}</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg text-primary">Legal</CardTitle>
          <CardDescription>Required on marketing emails and text messages by law.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="postal_address">Postal address</Label>
            <Textarea
              id="postal_address"
              aria-invalid={!!errors.postal_address}
              {...register("postal_address")}
            />
            {errors.postal_address && <p className="text-xs text-error">{errors.postal_address.message}</p>}
          </div>
        </CardContent>
      </Card>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : "Save settings"}
      </Button>
    </form>
  )
}
