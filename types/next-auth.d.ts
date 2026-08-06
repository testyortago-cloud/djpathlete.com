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
  }
}
