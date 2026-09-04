// functions/src/lib/tenancy-constants.ts
//
// TWIN of lib/lead-engine/constants.ts's SINGLETON_BUSINESS_ID.
// `functions/` cannot import from `lib/` (rootDir: "src" — see CLAUDE.md), so
// this value is duplicated here rather than imported. Keep the two literals
// identical if either ever changes.
export const SINGLETON_BUSINESS_ID = "00000000-0000-0000-0000-000000000001"
