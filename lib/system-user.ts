// Sentinel UUID used as `author_id` / `userId` for cron-generated work that
// has no human originator (auto-blog cron, SEO agent cron, etc.). Single
// source of truth — referenced by every internal cron route that needs to
// attribute a write to "the system".
export const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001"
