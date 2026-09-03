"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { businessCreateSchema, slugify, type BusinessCreateInput } from "@/lib/validators/business"

export function BusinessCreateForm() {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)
  // Tracks the web address to the name until the operator edits the web
  // address field directly -- then it stops following.
  const [slugFollowsName, setSlugFollowsName] = useState(true)

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<BusinessCreateInput>({
    resolver: zodResolver(businessCreateSchema),
    defaultValues: {
      name: "",
      slug: "",
      timezone: "",
      hostDisplayName: "",
      hostEmail: "",
    },
  })

  function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (slugFollowsName) {
      setValue("slug", slugify(e.target.value), { shouldValidate: true })
    }
  }

  async function onSubmit(data: BusinessCreateInput) {
    setServerError(null)
    const res = await fetch("/api/admin/businesses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    })

    if (res.status === 201) {
      const { business } = await res.json()
      router.push(`/admin/businesses/${business.id}`)
      return
    }

    const json = await res.json().catch(() => ({}))
    if (res.status === 409 && json.field === "slug") {
      setError("slug", { type: "server", message: json.error ?? "That web address is already taken" })
      return
    }
    setServerError(json.error ?? "Something went wrong. Please try again.")
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-lg space-y-4">
      {serverError && (
        <div role="alert" className="rounded border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
          {serverError}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "name-error" : undefined}
          {...register("name", { onChange: handleNameChange })}
        />
        {errors.name && (
          <p id="name-error" className="text-xs text-error">
            {errors.name.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="slug">Web address</Label>
        <Input
          id="slug"
          aria-invalid={!!errors.slug}
          aria-describedby={errors.slug ? "slug-error" : "slug-hint"}
          {...register("slug", {
            onChange: () => {
              // The operator touched this field directly -- stop copying the name.
              setSlugFollowsName(false)
            },
          })}
        />
        {errors.slug ? (
          <p id="slug-error" className="text-xs text-error">
            {errors.slug.message}
          </p>
        ) : (
          <p id="slug-hint" className="text-xs text-muted-foreground">
            This is the part of the web address that identifies this business. Lowercase letters,
            numbers and hyphens only.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="timezone">Timezone</Label>
        <Input
          id="timezone"
          placeholder="e.g. America/New_York"
          aria-invalid={!!errors.timezone}
          aria-describedby={errors.timezone ? "timezone-error" : "timezone-hint"}
          {...register("timezone")}
        />
        {errors.timezone ? (
          <p id="timezone-error" className="text-xs text-error">
            {errors.timezone.message}
          </p>
        ) : (
          <p id="timezone-hint" className="text-xs text-muted-foreground">
            Used to schedule this business&apos;s bookings and messages at the right local time.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="hostDisplayName">Who takes the calls?</Label>
        <Input
          id="hostDisplayName"
          aria-invalid={!!errors.hostDisplayName}
          aria-describedby={errors.hostDisplayName ? "hostDisplayName-error" : undefined}
          {...register("hostDisplayName")}
        />
        {errors.hostDisplayName && (
          <p id="hostDisplayName-error" className="text-xs text-error">
            {errors.hostDisplayName.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="hostEmail">Reply-to email</Label>
        <Input
          id="hostEmail"
          type="email"
          aria-invalid={!!errors.hostEmail}
          aria-describedby={errors.hostEmail ? "hostEmail-error" : "hostEmail-hint"}
          {...register("hostEmail")}
        />
        {errors.hostEmail ? (
          <p id="hostEmail-error" className="text-xs text-error">
            {errors.hostEmail.message}
          </p>
        ) : (
          <p id="hostEmail-hint" className="text-xs text-muted-foreground">
            Where replies to this business&apos;s emails land. Can be left blank for now.
          </p>
        )}
      </div>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Creating…" : "Create business"}
      </Button>
    </form>
  )
}
