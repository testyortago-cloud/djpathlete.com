# `ads` becomes owner-only

**Status:** shipped on `fix/ads-owner-only`, branched from `origin/main` @ `9dcc900a`.
**Kind:** deliberate narrowing. Not the permanent design — see "When to undo this".

## The footgun

`ads` was a tickable checkbox in the "Money" group on the teammate invite
screen, and `/admin/ads` + `/api/admin/ads` mapped to it in `PATH_PERMISSIONS`.

Behind that checkbox, `listGoogleAdsAccounts` (`lib/db/google-ads-accounts.ts:10`)
takes no `businessId` and applies no `.eq("business_id", ...)`. It returns
**every** business's ad accounts. Nine non-test callers sit on it:

| Caller | |
|---|---|
| 5 pages under `app/(admin)/admin/ads/` | the settings, overview and account screens |
| `app/api/admin/ads/diagnose/route.ts:62` | |
| `app/api/integrations/google-ads/disconnect/route.ts:26` | |
| `lib/ads/agent.ts:261` | automation |
| `lib/ads/weekly-report.ts:265` | automation |

So ticking one box for a coach would have shown them another business's ad
accounts and spend. Nothing had gone wrong yet only because nobody had ticked
it: production has zero staff users and zero accounts holding any permission.

The earlier plan (`2026-09-04-coach-reachability.md`) recorded `ads` as
"ungrantable in practice". That was the actual mistake — it was grantable in
fact, and only unexercised.

## What shipped

All in `lib/permissions/registry.ts`:

1. **Deleted** the `PATH_PERMISSIONS` rows for `/admin/ads` and `/api/admin/ads`.
2. **Added** both prefixes to `OWNER_ONLY_PREFIXES`, with a comment naming
   `lib/db/google-ads-accounts.ts:10` as the reason.
3. **Deleted** the `ads` `PermissionDef`, which is what removed the checkbox.
4. **Deleted** the `ads` `HOME_PRIORITY` entry (it could never be reached
   again — `staffHomePath` walks that list asking `hasPermission`).
5. **Deleted** `"ads"` from `TieredPermissionKey`.

Steps 1 and 2 must both happen. Two structural tests in
`__tests__/lib/permissions-registry.test.ts` enforce it: *"maps every path rule
to a real permission"* forbids leaving a row pointing at the deleted key, and
*"never maps a path that an owner-only prefix already claims"* forbids leaving
the row in place and merely shadowing it with the prefix. Half of this change
does not compile past the suite.

### Why the type member went too, and not just the definition

This was the one genuinely open decision. Measured rather than assumed —
with the `PermissionDef` deleted but `"ads"` still in `TieredPermissionKey`:

```
isPermissionKey("ads")                              = false
hasPermission({ads:"manage"}, "ads", "view")        = true
hasPermission({ads:"manage"}, "ads", "manage")      = true
sanitizePermissionMap({ads:"manage"})               = {}
```

`hasPermission` looks the key up in `PERMISSION_BY_KEY`, misses, and
`def?.kind` optional-chains to `undefined` — so it matches neither the
`boolean` branch nor the `view_only` branch and **falls through to the tiered
branch, which grants**. A key with no definition therefore reads as fully
granted.

`sanitizePermissionMap` drops it, so no *stored* map can carry `ads` — the
grant is unreachable from the database. But any `PermissionMap` built in
TypeScript (a preset, a fixture, a future default) would have compiled fine and
carried a silent grant with nothing behind it. Deleting the union member turns
that into a compile error instead. It is safe to delete precisely because zero
production accounts hold any permission, so there is no stored value to
migrate. The alternative — keeping the member and fixing `hasPermission` to
fail closed on an unknown key — is a better fix to a *different* bug, and
belongs with a change that has a reason to touch that function.

That latent fall-through is still there for any other key someone deletes the
same way. Worth closing separately; it is not closed here.

## What was deliberately NOT done

**The ads subsystem was not scoped.** `listGoogleAdsAccounts` and every other
ads reader are untouched. The frozen-seam inventory in `lib/tenancy/platform.ts`
already records why: 57 files across `app/(admin)/admin/ads/`,
`app/api/admin/ads/` and `app/api/integrations/google-ads/`, plus
`functions/src/ads/dal.ts`, which is a separate Firebase twin that cannot
import from `lib/`. Half of that graph is already tenant-aware
(`getActiveGoogleAdsAccounts` defaults to the singleton,
`upsertGoogleAdsAccount` requires a `businessId` and throws
`AdsAccountOwnedByAnotherBusinessError`) and half is not. Converting half of a
graph like that is how a silent cross-tenant *write* ships.

`lib/ads/agent.ts` and `lib/ads/weekly-report.ts` were also left alone: whether
an automation should iterate every tenant or exactly one is an unanswered
design question, not a cleanup.

**`/api/integrations/google-ads/*` was left alone.** It is not covered by
`proxy.ts`'s matcher and those routes gate themselves on `role === "admin"`,
so they are already closed to staff.

## When to undo this

When the ads subsystem is genuinely multi-tenant: move the two prefixes out of
`OWNER_ONLY_PREFIXES` back into `PATH_PERMISSIONS`, restore the `PermissionDef`
and the `HOME_PRIORITY` entry, and put `"ads"` back in `TieredPermissionKey`.

**Scope the reader first.** Restoring the checkbox before the reader has a
tenant predicate is the exact ordering that made this a footgun in the first
place.

## Verification

- `npx vitest run __tests__/lib/permissions-registry.test.ts
  __tests__/lib/coach-reachability.test.ts
  __tests__/components/admin/admin-nav.test.ts
  __tests__/lib/permissions-client-scope.test.ts` → **138 passed, 4 files.**
- `npx tsc --noEmit` → **251 errors, error set byte-identical to the
  `origin/main` baseline.** (Removing the union member first surfaced a TS2367
  "no overlap" in the new test, which is the type system confirming the key is
  gone; the runtime assertion keeps an `as string` cast so the suite still
  compiles and still asserts at runtime.)
- Four mutations, each applied and run rather than reasoned about:

  | Mutation | Result |
  |---|---|
  | re-add `{ prefix: "/admin/ads", permission: "ads" }` | **3 tests red** |
  | drop `/admin/ads` from `OWNER_ONLY_PREFIXES` | **1 test red** |
  | drop `/api/admin/ads` from `OWNER_ONLY_PREFIXES` | **1 test red** |
  | restore the `ads` `PermissionDef` | **1 test red** |

  Reverted after each; the clean tree is green.
