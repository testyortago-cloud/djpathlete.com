"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import type { ShippingAddress } from "@/lib/validators/shop"

// Local form schema — coerces empty strings for optional fields to null before
// validating, so the submitted value matches the ShippingAddress type the API needs.
const formSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z
    .string()
    .transform((v) => (v.trim() === "" ? null : v))
    .pipe(z.string().min(5).max(30).nullable()),
  line1: z.string().min(1).max(200),
  line2: z
    .string()
    .transform((v) => (v.trim() === "" ? null : v))
    .pipe(z.string().max(200).nullable()),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(50),
  country: z.string().length(2, "Country must be ISO 2-letter code"),
  postal_code: z.string().min(1).max(20),
})

// Raw values the form fields emit (optional text inputs use empty string "")
type FormInput = {
  name: string
  email: string
  phone: string
  line1: string
  line2: string
  city: string
  state: string
  country: string
  postal_code: string
}

// Output after zod transforms
type FormOutput = z.output<typeof formSchema>

const COUNTRIES = [
  { code: "US", label: "United States" },
  { code: "CA", label: "Canada" },
  { code: "GB", label: "United Kingdom" },
  { code: "AU", label: "Australia" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
  { code: "NL", label: "Netherlands" },
  { code: "SE", label: "Sweden" },
  { code: "NO", label: "Norway" },
  { code: "DK", label: "Denmark" },
  { code: "NZ", label: "New Zealand" },
  { code: "IE", label: "Ireland" },
  { code: "CH", label: "Switzerland" },
  { code: "AT", label: "Austria" },
  { code: "BE", label: "Belgium" },
]

interface AddressFormProps {
  initial?: Partial<ShippingAddress>
  onSubmit: (a: ShippingAddress) => void
  disabled?: boolean
}

export function AddressForm({ initial, onSubmit, disabled }: AddressFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: initial?.name ?? "",
      email: initial?.email ?? "",
      phone: initial?.phone ?? "",
      line1: initial?.line1 ?? "",
      line2: initial?.line2 ?? "",
      city: initial?.city ?? "",
      state: initial?.state ?? "",
      country: initial?.country ?? "US",
      postal_code: initial?.postal_code ?? "",
    },
  })

  function onValidSubmit(values: FormOutput) {
    onSubmit(values as ShippingAddress)
  }

  const fieldClass =
    "w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-body text-primary placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
  const labelClass = "block text-xs font-medium font-body text-muted-foreground mb-1"
  const errorClass = "mt-1 text-xs text-destructive font-body"

  return (
    <form onSubmit={handleSubmit(onValidSubmit)} className="space-y-5" noValidate>
      {/* Name */}
      <div>
        <label htmlFor="name" className={labelClass}>
          Full name <span className="text-destructive">*</span>
        </label>
        <input
          id="name"
          type="text"
          autoComplete="name"
          placeholder="Jane Smith"
          disabled={disabled}
          className={fieldClass}
          {...register("name")}
        />
        {errors.name && <p className={errorClass}>{errors.name.message}</p>}
      </div>

      {/* Email */}
      <div>
        <label htmlFor="email" className={labelClass}>
          Email <span className="text-destructive">*</span>
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="jane@example.com"
          disabled={disabled}
          className={fieldClass}
          {...register("email")}
        />
        {errors.email && <p className={errorClass}>{errors.email.message}</p>}
      </div>

      {/* Phone (optional) */}
      <div>
        <label htmlFor="phone" className={labelClass}>
          Phone <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <input
          id="phone"
          type="tel"
          autoComplete="tel"
          placeholder="+1 555 000 0000"
          disabled={disabled}
          className={fieldClass}
          {...register("phone")}
        />
        {errors.phone && <p className={errorClass}>{errors.phone.message}</p>}
      </div>

      {/* Address line 1 */}
      <div>
        <label htmlFor="line1" className={labelClass}>
          Address line 1 <span className="text-destructive">*</span>
        </label>
        <input
          id="line1"
          type="text"
          autoComplete="address-line1"
          placeholder="123 Main Street"
          disabled={disabled}
          className={fieldClass}
          {...register("line1")}
        />
        {errors.line1 && <p className={errorClass}>{errors.line1.message}</p>}
      </div>

      {/* Address line 2 (optional) */}
      <div>
        <label htmlFor="line2" className={labelClass}>
          Address line 2 <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <input
          id="line2"
          type="text"
          autoComplete="address-line2"
          placeholder="Apt, suite, etc."
          disabled={disabled}
          className={fieldClass}
          {...register("line2")}
        />
        {errors.line2 && <p className={errorClass}>{errors.line2.message}</p>}
      </div>

      {/* City + State row */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="city" className={labelClass}>
            City <span className="text-destructive">*</span>
          </label>
          <input
            id="city"
            type="text"
            autoComplete="address-level2"
            placeholder="San Francisco"
            disabled={disabled}
            className={fieldClass}
            {...register("city")}
          />
          {errors.city && <p className={errorClass}>{errors.city.message}</p>}
        </div>

        <div>
          <label htmlFor="state" className={labelClass}>
            State / Province <span className="text-destructive">*</span>
          </label>
          <input
            id="state"
            type="text"
            autoComplete="address-level1"
            placeholder="CA"
            disabled={disabled}
            className={fieldClass}
            {...register("state")}
          />
          {errors.state && <p className={errorClass}>{errors.state.message}</p>}
        </div>
      </div>

      {/* Country + Postal code row */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="country" className={labelClass}>
            Country <span className="text-destructive">*</span>
          </label>
          <select
            id="country"
            autoComplete="country"
            disabled={disabled}
            className={fieldClass}
            {...register("country")}
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
          {errors.country && <p className={errorClass}>{errors.country.message}</p>}
        </div>

        <div>
          <label htmlFor="postal_code" className={labelClass}>
            Postal code <span className="text-destructive">*</span>
          </label>
          <input
            id="postal_code"
            type="text"
            autoComplete="postal-code"
            placeholder="94107"
            disabled={disabled}
            className={fieldClass}
            {...register("postal_code")}
          />
          {errors.postal_code && <p className={errorClass}>{errors.postal_code.message}</p>}
        </div>
      </div>

      <button
        type="submit"
        disabled={disabled}
        className="w-full px-6 py-3 rounded-xl bg-primary text-primary-foreground font-medium font-body text-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Continue to shipping quote
      </button>
    </form>
  )
}
