import { getSetting } from "@/lib/db/system-settings"

// Public shareable athlete-profile links (coach-generated, permanent HMAC).
export const CLIENT_PROFILE_SHARE_KEY = "client_profile_share_enabled"

export const clientProfileShareEnabled = () => getSetting<boolean>(CLIENT_PROFILE_SHARE_KEY, false)
