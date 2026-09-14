import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { compare } from "bcryptjs"
import { createServiceRoleClient } from "@/lib/supabase"
import { decode as defaultDecode } from "next-auth/jwt"
import { recordAudit } from "@/lib/audit/record"
import { sanitizePermissionMap, type PermissionMap } from "@/lib/permissions/registry"
import { applyAbsoluteCap, SESSION_IDLE_MAX_AGE_SECONDS } from "@/lib/session-policy"
import type { UserRole } from "@/types/database"

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

        if (error || !user) {
          await recordAudit({
            action: "auth.login_failed",
            category: "auth",
            outcome: "failure",
            actor: { id: null, email, role: "anonymous" },
            metadata: { reason: "user_not_found" },
          })
          return null
        }
        if (!user.password_hash) {
          await recordAudit({
            action: "auth.login_failed",
            category: "auth",
            outcome: "failure",
            actor: { id: user.id, email, role: "anonymous" },
            metadata: { reason: "lead_no_password" },
          })
          return null
        }

        const isValid = await compare(password, user.password_hash)
        if (!isValid) {
          await recordAudit({
            action: "auth.login_failed",
            category: "auth",
            outcome: "failure",
            actor: { id: user.id, email, role: "anonymous" },
            metadata: { reason: "bad_password" },
          })
          return null
        }

        await recordAudit({
          action: "auth.login_succeeded",
          category: "auth",
          outcome: "success",
          actor: { id: user.id, email: user.email, role: user.role },
        })

        console.log(`[Auth] Login: ${user.email}, role: ${user.role}`)
        return {
          id: user.id,
          email: user.email,
          name: `${user.first_name} ${user.last_name}`,
          role: user.role,
          permissions: sanitizePermissionMap(user.permissions),
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
        // Stale cookie encrypted with a previous secret, or a cookie copied
        // across environments. Returning null tells NextAuth to clear the
        // cookie and treat the request as unauthenticated.
        return null
      }
    },
  },
  logger: {
    error(error) {
      // JWTSessionError is the user-recoverable case our jwt.decode override
      // already handles (stale/invalid cookie -> session cleared -> user
      // re-authenticates). Suppress it instead of polluting the dev console
      // with a multi-frame stack trace on every refresh.
      if (error?.name === "JWTSessionError") return
      console.error(error)
    },
  },
  callbacks: {
    async jwt({ token, user, trigger }) {
      // On initial sign-in, set id and role from the authorize() return
      if (user) {
        token.id = user.id as string
        token.role = user.role as UserRole
        token.permissions = (user.permissions as PermissionMap | undefined) ?? {}
      }

      // Absolute cap. `maxAge` below is a SLIDING window — it renews on every
      // page load — so on its own it can be extended forever and a device that
      // walks away stays signed in. `loginAt` is stamped once at sign-in and
      // never moves, so this is the clock no amount of activity can reset.
      // A null return destroys the session: @auth/core clears the cookie rather
      // than re-signing it, and SessionExpiryGuard takes the browser to /login.
      if (applyAbsoluteCap(token, Boolean(user), Date.now()) === null) return null

      // On session update or subsequent requests, refresh from DB.
      // Permissions ride along here on purpose: revoking a teammate's access
      // then takes effect on their next request rather than waiting out the
      // 24-hour token, which is the whole point of being able to revoke.
      if ((trigger === "update" || trigger !== "signIn") && token.id) {
        try {
          const supabase = createServiceRoleClient()
          const { data } = await supabase
            .from("users")
            .select("role, first_name, last_name, email, permissions")
            .eq("id", token.id)
            .single()
          if (data) {
            token.role = data.role as UserRole
            token.name = `${data.first_name} ${data.last_name}`
            token.email = data.email
            token.permissions = sanitizePermissionMap(data.permissions)
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
        session.user.permissions = token.permissions ?? {}
        if (token.name) session.user.name = token.name
        if (token.email) session.user.email = token.email
      }
      return session
    },
  },
  session: {
    strategy: "jwt",
    // Idle window, not a fixed lifetime — see lib/session-policy.ts for why
    // this slides and what stops it sliding forever.
    maxAge: SESSION_IDLE_MAX_AGE_SECONDS,
  },
})
