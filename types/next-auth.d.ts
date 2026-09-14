import type { DefaultSession, DefaultUser } from "next-auth"
import type { DefaultJWT } from "next-auth/jwt"
import type { UserRole } from "./database"
import type { PermissionMap } from "@/lib/permissions/registry"

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string
      role: UserRole
      /** Empty for every role except `staff`. Refreshed from the DB on each request. */
      permissions: PermissionMap
    } & DefaultSession["user"]
  }

  interface User extends DefaultUser {
    role: UserRole
    permissions?: PermissionMap
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string
    role: UserRole
    permissions: PermissionMap
    /**
     * Epoch ms of the sign-in this session descends from. Set once, then carried
     * forward through every re-sign — it is the one clock activity cannot move,
     * and so the only thing that makes a session ever end. See
     * `lib/session-policy.ts`.
     */
    loginAt?: number
  }
}
