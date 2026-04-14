import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { compare } from "bcryptjs"
import { createServiceRoleClient } from "@/lib/supabase"
import { decode as defaultDecode } from "next-auth/jwt"

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const email = credentials.email as string
        const password = credentials.password as string

        // Use service role client to bypass RLS for auth queries
        const supabase = createServiceRoleClient()
        const { data: user, error } = await supabase.from("users").select("*").eq("email", email).single()

        if (error || !user) return null

        const isValid = await compare(password, user.password_hash)
        if (!isValid) return null

        console.log(`[Auth] Login: ${user.email}, role: ${user.role}`)
        return {
          id: user.id,
          email: user.email,
          name: `${user.first_name} ${user.last_name}`,
          role: user.role,
        }
      },
    }),
  ],
  pages: {
    signIn: "/login",
    newUser: "/register",
  },
  jwt: {
    async decode(params) {
      try {
        return await defaultDecode(params)
      } catch {
        // Stale cookie encrypted with a previous secret — return null to
        // force a fresh sign-in instead of crashing with JWTSessionError.
        console.warn("[auth] Failed to decode JWT (secret may have changed), clearing session")
        return null
      }
    },
  },
  callbacks: {
    async jwt({ token, user, trigger }) {
      // On initial sign-in, set id and role from the authorize() return
      if (user) {
        token.id = user.id as string
        token.role = user.role as "admin" | "client"
      }

      // On session update or subsequent requests, refresh from DB
      if ((trigger === "update" || trigger !== "signIn") && token.id) {
        try {
          const supabase = createServiceRoleClient()
          const { data } = await supabase
            .from("users")
            .select("role, first_name, last_name, email")
            .eq("id", token.id)
            .single()
          if (data) {
            token.role = data.role as "admin" | "client"
            token.name = `${data.first_name} ${data.last_name}`
            token.email = data.email
          }
        } catch {
          // If DB lookup fails, keep existing token values
        }
      }

      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id
        session.user.role = token.role
        if (token.name) session.user.name = token.name
        if (token.email) session.user.email = token.email
      }
      return session
    },
  },
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },
})
