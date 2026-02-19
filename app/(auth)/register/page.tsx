import type { Metadata } from "next"
import { RegisterForm } from "./RegisterForm"

export const metadata: Metadata = {
  title: "Create Account",
  description: "Create your DJP Athlete account.",
}

export default function RegisterPage() {
  return <RegisterForm />
}
