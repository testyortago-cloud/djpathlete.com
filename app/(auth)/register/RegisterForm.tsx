"use client"

import { useState, useMemo } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Eye, EyeOff, ShieldCheck, ArrowLeft, ArrowRight } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"

interface FieldErrors {
  firstName?: string[]
  lastName?: string[]
  dateOfBirth?: string[]
  email?: string[]
  password?: string[]
  confirmPassword?: string[]
  termsAccepted?: string[]
  guardianName?: string[]
  guardianEmail?: string[]
  parentalConsent?: string[]
}

function calculateAge(dateOfBirth: string): number {
  const today = new Date()
  const birth = new Date(dateOfBirth)
  let age = today.getFullYear() - birth.getFullYear()
  const monthDiff = today.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--
  }
  return age
}

export function RegisterForm() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [dateOfBirth, setDateOfBirth] = useState("")
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [parentalConsent, setParentalConsent] = useState(false)

  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [guardianName, setGuardianName] = useState("")
  const [guardianEmail, setGuardianEmail] = useState("")

  const age = useMemo(() => {
    if (!dateOfBirth) return null
    const parsed = new Date(dateOfBirth)
    if (isNaN(parsed.getTime())) return null
    return calculateAge(dateOfBirth)
  }, [dateOfBirth])

  const isMinor = age !== null && age >= 13 && age < 18
  const isTooYoung = age !== null && age < 13
  // Adults get a single-page form; minors get 2 steps
  const needsStep2 = isMinor

  function validateStep1(): boolean {
    const errors: FieldErrors = {}
    if (!firstName.trim()) errors.firstName = ["First name is required"]
    if (!lastName.trim()) errors.lastName = ["Last name is required"]
    if (!dateOfBirth) errors.dateOfBirth = ["Date of birth is required"]
    else if (isTooYoung) errors.dateOfBirth = ["You must be at least 13 years old"]
    if (!email.trim()) errors.email = ["Email is required"]
    if (!password || password.length < 8) errors.password = ["Password must be at least 8 characters"]
    if (password !== confirmPassword) errors.confirmPassword = ["Passwords don't match"]

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return false
    }
    setFieldErrors({})
    return true
  }

  function handleNext() {
    setError(null)
    if (validateStep1()) {
      setStep(2)
    }
  }

  async function doSubmit() {
    setError(null)
    setFieldErrors({})
    setIsLoading(true)

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName,
          dateOfBirth,
          email,
          password,
          confirmPassword,
          termsAccepted,
          ...(isMinor && {
            guardianName,
            guardianEmail,
            parentalConsent,
          }),
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        if (data.details) {
          const details = data.details as FieldErrors
          setFieldErrors(details)
          const step1Fields: (keyof FieldErrors)[] = ["firstName", "lastName", "dateOfBirth", "email", "password", "confirmPassword"]
          if (needsStep2 && step1Fields.some((f) => details[f])) {
            setStep(1)
          }
        }
        setError(data.error || "Registration failed. Please try again.")
        setIsLoading(false)
        return
      }

      const signInResult = await signIn("credentials", {
        email,
        password,
        redirect: false,
      })

      if (signInResult?.error) {
        router.push("/login")
        return
      }

      router.push("/client/questionnaire")
      router.refresh()
    } catch {
      setError("An unexpected error occurred. Please try again.")
      setIsLoading(false)
    }
  }

  function handleAdultSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!validateStep1()) return
    doSubmit()
  }

  function handleMinorSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    doSubmit()
  }

  function getFieldError(field: keyof FieldErrors): string | undefined {
    return fieldErrors[field]?.[0]
  }

  const today = new Date().toISOString().split("T")[0]

  // ── Header ──
  const heading = step === 1
    ? "Create your account"
    : "Almost there"
  const subheading = step === 1
    ? "Start your athletic journey with DJP Athlete"
    : "We just need a few more details"

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-primary tracking-tight">
          {heading}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{subheading}</p>
        {/* Step indicator — only shown for minors */}
        {needsStep2 && (
          <div className="mt-4 flex gap-2">
            <div className={`h-1 flex-1 rounded-full transition-colors ${step >= 1 ? "bg-primary" : "bg-border"}`} />
            <div className={`h-1 flex-1 rounded-full transition-colors ${step >= 2 ? "bg-primary" : "bg-border"}`} />
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* ── Step 1: Account details (always shown on step 1) ── */}
      {step === 1 && (
        <form
          onSubmit={needsStep2 ? (e) => { e.preventDefault(); handleNext() } : handleAdultSubmit}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="firstName" className="text-sm font-medium text-primary">
                First name
              </Label>
              <Input
                id="firstName"
                name="firstName"
                type="text"
                placeholder="John"
                required
                disabled={isLoading}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="h-11 rounded-lg border-border focus:border-primary focus:ring-primary"
              />
              {getFieldError("firstName") && (
                <p className="text-xs text-destructive">{getFieldError("firstName")}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName" className="text-sm font-medium text-primary">
                Last name
              </Label>
              <Input
                id="lastName"
                name="lastName"
                type="text"
                placeholder="Doe"
                required
                disabled={isLoading}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="h-11 rounded-lg border-border focus:border-primary focus:ring-primary"
              />
              {getFieldError("lastName") && (
                <p className="text-xs text-destructive">{getFieldError("lastName")}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dateOfBirth" className="text-sm font-medium text-primary">
              Date of birth
            </Label>
            <Input
              id="dateOfBirth"
              name="dateOfBirth"
              type="date"
              required
              disabled={isLoading}
              max={today}
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className="h-11 rounded-lg border-border focus:border-primary focus:ring-primary"
            />
            {isTooYoung && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-900/50 dark:bg-amber-950/30">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                  You need to be at least 13 to sign up. Ask a parent or guardian for help!
                </p>
              </div>
            )}
            {getFieldError("dateOfBirth") && (
              <p className="text-xs text-destructive">{getFieldError("dateOfBirth")}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email" className="text-sm font-medium text-primary">
              Email
            </Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              required
              disabled={isLoading}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 rounded-lg border-border focus:border-primary focus:ring-primary"
            />
            {getFieldError("email") && (
              <p className="text-xs text-destructive">{getFieldError("email")}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium text-primary">
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  required
                  disabled={isLoading}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 rounded-lg border-border focus:border-primary focus:ring-primary pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {getFieldError("password") && (
                <p className="text-xs text-destructive">{getFieldError("password")}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-sm font-medium text-primary">
                Confirm password
              </Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="••••••••"
                  required
                  disabled={isLoading}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="h-11 rounded-lg border-border focus:border-primary focus:ring-primary pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors"
                  tabIndex={-1}
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {getFieldError("confirmPassword") && (
                <p className="text-xs text-destructive">{getFieldError("confirmPassword")}</p>
              )}
            </div>
          </div>

          {/* Terms checkbox — inline for adults only (minors see it on step 2) */}
          {!needsStep2 && (
            <>
              <div className="flex items-start gap-3">
                <Checkbox
                  id="termsAccepted"
                  checked={termsAccepted}
                  onCheckedChange={(checked) => setTermsAccepted(checked === true)}
                  disabled={isLoading}
                  className="mt-0.5"
                />
                <Label htmlFor="termsAccepted" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
                  I have read and agree to the{" "}
                  <Link href="/terms-of-service" target="_blank" className="underline hover:text-primary">
                    Terms of Service
                  </Link>{" "}
                  and{" "}
                  <Link href="/privacy-policy" target="_blank" className="underline hover:text-primary">
                    Privacy Policy
                  </Link>
                </Label>
              </div>
              {getFieldError("termsAccepted") && (
                <p className="text-xs text-destructive">{getFieldError("termsAccepted")}</p>
              )}
            </>
          )}

          <button
            type="submit"
            disabled={isLoading || isTooYoung}
            className="w-full rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 hover:shadow-lg active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
          >
            {needsStep2 ? (
              <>
                Continue
                <ArrowRight size={16} />
              </>
            ) : isLoading ? (
              "Creating Account..."
            ) : (
              "Create Account"
            )}
          </button>
        </form>
      )}

      {/* ── Step 2: Parental consent (minors only) ── */}
      {step === 2 && needsStep2 && (
        <form onSubmit={handleMinorSubmit} className="space-y-5">
          <div className="relative overflow-hidden rounded-xl border border-accent/30 bg-gradient-to-br from-accent/5 via-background to-primary/5 p-5 space-y-4">
            <div className="absolute -right-3 -top-3 h-16 w-16 rounded-full bg-accent/10 blur-2xl" />
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15">
                <ShieldCheck className="h-4 w-4 text-accent" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Parent or Guardian Approval
                </p>
                <p className="text-xs text-muted-foreground">
                  Since you&apos;re under 18, a parent or guardian must approve
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="guardianName" className="text-xs font-medium text-muted-foreground">
                  Their name
                </Label>
                <Input
                  id="guardianName"
                  name="guardianName"
                  type="text"
                  placeholder="e.g. Jane Doe"
                  required
                  disabled={isLoading}
                  value={guardianName}
                  onChange={(e) => setGuardianName(e.target.value)}
                  className="h-10 rounded-lg border-accent/20 bg-white/80 text-sm focus:border-accent focus:ring-accent dark:bg-background/80"
                />
                {getFieldError("guardianName") && (
                  <p className="text-xs text-destructive">{getFieldError("guardianName")}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="guardianEmail" className="text-xs font-medium text-muted-foreground">
                  Their email
                </Label>
                <Input
                  id="guardianEmail"
                  name="guardianEmail"
                  type="email"
                  placeholder="parent@email.com"
                  required
                  disabled={isLoading}
                  value={guardianEmail}
                  onChange={(e) => setGuardianEmail(e.target.value)}
                  className="h-10 rounded-lg border-accent/20 bg-white/80 text-sm focus:border-accent focus:ring-accent dark:bg-background/80"
                />
                {getFieldError("guardianEmail") && (
                  <p className="text-xs text-destructive">{getFieldError("guardianEmail")}</p>
                )}
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg bg-white/60 dark:bg-muted/30 p-3">
              <Checkbox
                id="parentalConsent"
                checked={parentalConsent}
                onCheckedChange={(checked) => {
                  setParentalConsent(checked === true)
                  setTermsAccepted(checked === true)
                }}
                disabled={isLoading}
                className="mt-0.5 border-accent/40 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
              />
              <Label htmlFor="parentalConsent" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
                My parent/guardian and I have reviewed and agree to the{" "}
                <Link href="/terms-of-service" target="_blank" className="font-medium text-accent underline decoration-accent/30 hover:decoration-accent">
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link href="/privacy-policy" target="_blank" className="font-medium text-accent underline decoration-accent/30 hover:decoration-accent">
                  Privacy Policy
                </Link>
              </Label>
            </div>
            {(getFieldError("parentalConsent") || getFieldError("termsAccepted")) && (
              <p className="text-xs text-destructive">
                {getFieldError("parentalConsent") || getFieldError("termsAccepted")}
              </p>
            )}
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={() => { setStep(1); setError(null) }}
              disabled={isLoading}
              className="flex items-center justify-center gap-1.5 rounded-full border border-border px-4 py-3 text-sm font-medium text-muted-foreground transition-all hover:bg-muted hover:text-foreground active:scale-[0.98] disabled:opacity-50"
            >
              <ArrowLeft size={16} />
              Back
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 hover:shadow-lg active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
            >
              {isLoading ? "Creating Account..." : "Create Account"}
            </button>
          </div>
        </form>
      )}

      <p className="mt-8 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Log in
        </Link>
      </p>
    </>
  )
}
