"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ClientProfile, Gender, ExperienceLevel } from "@/types/database"

interface ProfileFormProps {
  profile: ClientProfile | null
}

const genderOptions: { value: Gender; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
]

const experienceLevelOptions: { value: ExperienceLevel; label: string }[] = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
  { value: "elite", label: "Elite" },
]

export function ProfileForm({ profile }: ProfileFormProps) {
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{
    type: "success" | "error"
    text: string
  } | null>(null)

  const [sport, setSport] = useState(profile?.sport ?? "")
  const [position, setPosition] = useState(profile?.position ?? "")
  const [experienceLevel, setExperienceLevel] = useState<string>(
    profile?.experience_level ?? ""
  )
  const [goals, setGoals] = useState(profile?.goals ?? "")
  const [injuries, setInjuries] = useState(profile?.injuries ?? "")
  const [heightCm, setHeightCm] = useState(
    profile?.height_cm?.toString() ?? ""
  )
  const [weightKg, setWeightKg] = useState(
    profile?.weight_kg?.toString() ?? ""
  )
  const [dateOfBirth, setDateOfBirth] = useState(
    profile?.date_of_birth ?? ""
  )
  const [gender, setGender] = useState<string>(profile?.gender ?? "")
  const [emergencyContactName, setEmergencyContactName] = useState(
    profile?.emergency_contact_name ?? ""
  )
  const [emergencyContactPhone, setEmergencyContactPhone] = useState(
    profile?.emergency_contact_phone ?? ""
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage(null)

    try {
      const body: Record<string, unknown> = {
        sport: sport || null,
        position: position || null,
        experience_level: experienceLevel || null,
        goals: goals || null,
        injuries: injuries || null,
        height_cm: heightCm ? Number(heightCm) : null,
        weight_kg: weightKg ? Number(weightKg) : null,
        date_of_birth: dateOfBirth || null,
        gender: gender || null,
        emergency_contact_name: emergencyContactName || null,
        emergency_contact_phone: emergencyContactPhone || null,
      }

      const res = await fetch("/api/client/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? "Failed to update profile")
      }

      setMessage({ type: "success", text: "Profile updated successfully." })
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Something went wrong.",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="bg-white rounded-xl border border-border p-4 sm:p-6 space-y-5 sm:space-y-6">
        <h2 className="text-[10px] sm:text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Athletic Profile
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="sport">Sport</Label>
            <Input
              id="sport"
              value={sport}
              onChange={(e) => setSport(e.target.value)}
              placeholder="e.g., Basketball, Soccer"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="position">Position</Label>
            <Input
              id="position"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder="e.g., Point Guard, Striker"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="experience_level">Experience Level</Label>
            <Select
              value={experienceLevel}
              onValueChange={setExperienceLevel}
            >
              <SelectTrigger id="experience_level" className="w-full">
                <SelectValue placeholder="Select level" />
              </SelectTrigger>
              <SelectContent>
                {experienceLevelOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="gender">Gender</Label>
            <Select value={gender} onValueChange={setGender}>
              <SelectTrigger id="gender" className="w-full">
                <SelectValue placeholder="Select gender" />
              </SelectTrigger>
              <SelectContent>
                {genderOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="goals">Goals</Label>
          <textarea
            id="goals"
            value={goals}
            onChange={(e) => setGoals(e.target.value)}
            placeholder="What are your training goals?"
            rows={3}
            className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="injuries">Injuries / Medical Notes</Label>
          <textarea
            id="injuries"
            value={injuries}
            onChange={(e) => setInjuries(e.target.value)}
            placeholder="Any current or past injuries to be aware of?"
            rows={3}
            className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none"
          />
        </div>

        <h2 className="text-[10px] sm:text-sm font-semibold text-muted-foreground uppercase tracking-wider pt-2">
          Physical Information
        </h2>

        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          <div className="space-y-2">
            <Label htmlFor="date_of_birth">Date of Birth</Label>
            <Input
              id="date_of_birth"
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="height_cm">Height (cm)</Label>
            <Input
              id="height_cm"
              type="number"
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
              placeholder="e.g., 180"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="weight_kg">Weight (kg)</Label>
            <Input
              id="weight_kg"
              type="number"
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              placeholder="e.g., 75"
            />
          </div>
        </div>

        <h2 className="text-[10px] sm:text-sm font-semibold text-muted-foreground uppercase tracking-wider pt-2">
          Emergency Contact
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="emergency_contact_name">Contact Name</Label>
            <Input
              id="emergency_contact_name"
              value={emergencyContactName}
              onChange={(e) => setEmergencyContactName(e.target.value)}
              placeholder="Full name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="emergency_contact_phone">Contact Phone</Label>
            <Input
              id="emergency_contact_phone"
              type="tel"
              value={emergencyContactPhone}
              onChange={(e) => setEmergencyContactPhone(e.target.value)}
              placeholder="Phone number"
            />
          </div>
        </div>

        {/* Feedback message */}
        {message && (
          <div
            className={`text-sm font-medium rounded-lg px-4 py-2 ${
              message.type === "success"
                ? "bg-success/10 text-success"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save Profile"}
          </Button>
        </div>
      </div>
    </form>
  )
}
