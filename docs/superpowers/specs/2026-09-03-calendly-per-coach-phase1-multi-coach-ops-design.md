# Calendly per coach — phase 1: multi-coach operations

**Date:** 2026-09-03
**Branch:** `feat/calendly-per-coach-phase1`, cut from `main` @ `963745ab`
**Parent spec:** [`2026-09-03-native-multi-coach-booking-design.md`](2026-09-03-native-multi-coach-booking-design.md) §4 (tenancy), §14.2 / §14.4 phase 1 — *on the unmerged `docs/native-booking-research` branch; it is not on `main`*
**Phase 0:** [spec](2026-09-03-calendly-per-coach-phase0-tenancy-design.md) · [status and handover](../../calendly-per-coach-phase0-status.md)

---

## 0. The short version

Phase 0 made a second coach *possible* in the schema. Nothing can still **create** one: `lib/db/businesses.ts` has a getter and a setter and nothing inserts into `businesses`, `business_members` has exactly one reader in the whole repo (the booking notification fan-out), and every admin screen reads a hard-coded constant. Phase 1 closes that: a business can be created, a coach can be invited into it, its settings can be edited, and the admin screens show its rows.

**Done means:** the operator creates a business through a real form, invites a coach to it, edits that business's settings, and `/admin/contacts`, `/admin/pipeline`, `/admin/bookings`, `/admin/chat` and `/admin/quizzes` show that business's rows rather than the singleton's — driven in a browser, not asserted.

### The decisions this document makes

| # | Decision | Why not the alternative |
|---|---|---|
| 1 | **A coach is `users.role = 'staff'` + a permission map + a `business_members` row.** Membership carries the tenant; permissions carry the capability. | Widening `users.role` makes every exhaustive two-branch conditional in `proxy.ts` and the admin layout a latent bug, and the prompt forbids it. A new role would also duplicate the entire `lib/permissions/registry.ts` catalogue. |
| 2 | **`createBusiness` is a plpgsql function**, called through `.rpc()`. | supabase-js cannot open a transaction. Four separate inserts leave a half-built tenant on any failure — a `businesses` row with no settings is a business every screen throws on. `merge_contacts` already establishes plpgsql as this repo's answer for a multi-row atomic write. |
| 3 | **The operator is an implicit owner of every business, not a member row.** | The owner's answer: operator sees all, coaches see only their own. Materialising owner rows means every `createBusiness` must also insert one per operator, and every operator added later needs a backfill. `role === 'admin'` already means "the operator" everywhere in this codebase. |
| 4 | **Membership is universal, so its ABSENCE means "no access".** Migration `00246` backfills every existing teammate; both invite paths write a row. *(Revised after Task 3's review — the original decision was a singleton fallback for a staff user with no rows.)* | The fallback could not tell *predates multi-tenancy* from *membership just revoked*, so offboarding a coach by deleting their row **promoted** them into the operator's own tenant. A backfill turns an inferred compatibility path into explicit data, and the resolver then refuses to invent a tenant at all (decision 11). |
| 5 | **The selected business is a cookie, validated against the caller's allowed set on every read.** | A cookie that is trusted as given is a one-header cross-tenant read. The allowed set is recomputed server-side per request; the cookie only ever *chooses among* it. |
| 6 | **Twilio inbound resolves its tenant from the `To` number** via `business_settings.sms_sender_phone`. | That column already exists (`00221`) and the `To` number is the only tenant evidence an inbound SMS carries. This is a real resolution, not a placeholder. |
| 7 | **The Stripe webhook resolves its tenant from the payer's contact row**, through one deliberately unscoped lookup. | One Stripe account serves every business, so the webhook carries no tenant. The contact record does. See §7.2 for the tie-break when two businesses know the same email. |
| 8 | **The Calendly and GHL webhooks keep the platform business, behind a named seam** (`platformBusinessId()`), not a bare constant. | Phase 2 resolves these from the connection row, which does not exist yet. A named function is one greppable seam for phase 2 instead of four literals; calling it a resolution would be a lie. |
| 9 | **`slug` becomes `NOT NULL` with its CHECK in the same deploy as the code.** | Safe *because nothing inserts into `businesses` today* — there is no writer that could omit it. Reasoned, not assumed: see §8.2. |
| 11 | **The resolver NEVER invents a business id.** An empty allowed set throws `NoAccessibleBusinessError`; the admin layout catches it and redirects to `/admin/no-access`. The operator's allowed set ignores `status`, so pausing the last business cannot lock them out of the screen that un-pauses it. *(Added after Task 3's review.)* | The original `?? SINGLETON_BUSINESS_ID` fallback meant a coach whose only business was paused was handed the operator's tenant — every contact, pipeline card and booking in it. A fallback constant in a tenancy resolver is a privilege escalation waiting for an ordinary admin action to trigger it. |
| 10 | **Crons iterate active businesses but still write one `cron_runs` row per tick.** | `lastSuccessPerCron` selects the single most recent successful row per `cron_name`, so a row per business would hide a business failing every tick behind any business that succeeded. Parent spec §4.2. |

### What phase 1 does NOT build

Not omissions — each is out of scope by decision.

- **No per-tenant RLS.** The owner's answer makes `business_members` a permission model for *coaches*, with the operator seeing everything; app-side `.eq("business_id", …)` in the DAL is the model phase 0 shipped and this phase keeps. Parent spec §4.5 and V2 stay open.
- **No self-serve signup and no invite-accept token flow for membership.** The owner's answer is 1–2 coaches over six months, onboarded by hand. Membership is granted on the existing `team_invites` accept path (§6.3), which already has tokens, 7-day expiry, revoke and rotate. A public accept route would be a new unauthenticated write path for no user.
- **No `business_domains` UI, no host→tenant resolution in `proxy.ts`.** That is phase 4, and it needs the Vercel domains API. `business_domains` keeps its zero writers.
- **No Calendly OAuth, no `fn_*` calendar-connection quartet, no neutral `Slot` type.** Phase 2.
- **No exclusion constraint and no `btree_gist`.** Settled in phase 0: a `23P01` inside the webhook is how a coach's Calendly subscription gets disabled.
- **No `booking_types` / availability UI.** Calendly holds the rules on this path.
- **No `marketing_attribution.business_id` column.** §7.3 explains why the fix there is a predicate on the *join*, not a new column.

---

## 1. What phase 0 left, and what the owner answered

Phase 0 is merged and deployed; `main` is `963745ab` and migrations `00239`–`00242` are on production. Two facts bound this phase and neither is a bug in it:

- **`feat/calendly-per-coach-tighten` is pushed and unmerged.** It holds `00243` (`bookings.host_id` / `end_at` NOT NULL). Its preconditions must be read back on production *at merge time*. This phase does not touch it, does not depend on it, and does not merge it. §11.3.
- **Production has zero `CALENDLY_*` values.** The Calendly half is deployed and inert. No booking can arrive until the owner sets them, so "no bookings" is not a phase-1 regression.

The owner answered three questions on 2026-09-03, and all three shape what follows:

1. **Isolation — "operator sees all, coaches see only their own."** `business_members` is a permission model for coaches. Decisions 1, 3, 4, 5 follow. Per-tenant RLS is a later nicety, not a launch requirement.
2. **Scale — "1–2 coaches over ~6 months, onboarded by hand."** Decision: no accept-token flow of its own, no self-signup. This is what keeps §6.3 small.
3. **Production reads — "you run the two SELECTs."** No `supabase-prod` MCP call and no `.env.prod` load happens anywhere in this phase. The dev clone (`anjvztjiokcgiyhobknq`) is the only database this branch touches.

---

## 2. What a coach *is*

This is the load-bearing decision and everything else hangs off it.

```
users.role = 'staff'          -- which door they come through   (unchanged enum)
users.permissions = {...}     -- WHAT they may do               (existing registry)
business_members(business_id, -- WHICH ROWS they may see        (new dimension)
                 user_id,
                 role='coach')
```

Three orthogonal axes, none of which needs the other to change:

- **`users.role`** stays `admin | client | editor | staff`. A coach is `staff`. `proxy.ts:86` and `:111` already gate `staff` through `canAccessPath`, and `staffHomePath` already routes them. Nothing in the middleware changes.
- **`lib/permissions/registry.ts`** already answers "may this person open `/admin/contacts`". A coach gets `leads`, `clients`, `schedule`, `messages` — whatever the operator ticks on the existing invite screen. **No new permission keys.** Default-deny still holds: a surface in no rule is denied.
- **`business_members.role`** (`owner | coach | staff`) answers "whose rows". This is the only new axis, and it is the one phase 0 already created the table for.

**Why this is right and not merely cheap.** The parent spec's §4.1 makes exactly this argument: a role answers "what may this login do"; a host answers "whose calendar". Membership is the third question — "whose data" — and it genuinely is independent of the first two. The operator is `admin` with no membership row and sees everything. A coach is `staff` with one membership row and sees one business. An existing teammate is `staff` with no membership row and sees the singleton, exactly as today.

**`booking_hosts` is not the same thing as membership.** A coach gets both: a `business_members` row (access) and a `booking_hosts` row (a calendar, a timezone, a location). `createBusiness` creates the host row because `bookings.host_id` is NOT NULL after `00243` and a business with no host cannot receive a booking.

---

## 3. Resolving the tenant in `/admin`

### 3.1 The resolver

New module `lib/tenancy/resolve.ts` — pure of `next/*` beyond `cookies()`, one exported async function:

```ts
export type BusinessChoice = { id: string; name: string; slug: string | null }

export type ResolvedTenant = {
  /** The business whose rows this request may read and write. */
  businessId: string
  /** Every business this caller may switch to. One entry = no switcher. */
  choices: BusinessChoice[]
  /** True for the operator, who is an implicit owner of every business. */
  isOperator: boolean
}

export async function resolveAdminTenant(): Promise<ResolvedTenant>
```

The algorithm, in order:

1. `session = await auth()`. No session → throw; the caller is behind `requireAdmin()` / the middleware already.
2. **Allowed set.**
   - `role === 'admin'` → every row in `businesses where status = 'active'`, ordered by `name`. `isOperator = true`.
   - otherwise → `businesses` joined through `business_members where user_id = session.user.id`, `status = 'active'`.
3. **Empty allowed set** → `[{ id: SINGLETON_BUSINESS_ID, … }]`, read from `businesses`. Decision 4: this is the compatibility path for every staff user who predates multi-coach, and it must stay until they all have membership rows.
4. **Selection.** Read the `djp_business` cookie. **Honour it only if it is in the allowed set.** Otherwise take the first entry. A cookie naming a business the caller may not see is ignored silently — not an error, because a coach whose membership was revoked should land on something, not a 500.
5. Return.

**Step 4 is the security boundary of this phase.** Its test mutates the cookie value to a business the caller is not a member of and asserts the *resolved id is unchanged* — not merely that no error was thrown. Per the phase-0 lesson, the mock records the `.eq()` arguments and the test asserts them, and the mutation proves it by changing the **value**, not the arity.

**PostgREST resolves, it does not throw.** Every read in this module checks `error` and throws on it. A failed `business_members` read must never come back as "no memberships", because step 3 would then silently widen a coach to the singleton — the exact shape of the two phase-0 defects.

### 3.2 The switcher

`components/admin/BusinessSwitcher.tsx`, rendered in the admin layout **only when `choices.length > 1`**. A coach with one business sees nothing, which is the parent spec's rule. It sets the `djp_business` cookie through a small server action and calls `revalidatePath("/admin")`.

Cookie: `djp_business`, `httpOnly`, `sameSite: "lax"`, `secure` in production, path `/`, session-lifetime. It is a *preference*, never an authorisation — §3.1 step 4 is what makes that true.

### 3.3 The API side

`lib/tenancy/resolve.ts` serves server components. Route handlers under `/api/admin/*` get `resolveAdminTenantForRequest(req)` from the same module, which reads the cookie off `req.cookies` and runs the identical allowed-set logic. **One implementation of the allowed set, two cookie sources** — if the page and the API disagree about which business a caller may read, one of them is a leak.

---

## 4. `createBusiness`

### 4.1 The function

Migration `00244` creates `public.create_business(...)`, `plpgsql`, `SECURITY DEFINER`, `revoke all from public` / `grant execute to service_role` — the posture every other function in this repo uses. It writes four rows in one transaction:

```
businesses            (id, name, slug, status='active', booking_provider='calendly', created_by)
business_settings     (business_id, display_name, timezone)          -- every other column has a DEFAULT
booking_hosts         (business_id, user_id=null, display_name, email, timezone)
business_members      (business_id, user_id=<creator>, role='owner')
```

Returns the created `businesses` row. Raises on a duplicate slug so the DAL can map `23505` to a field error rather than a 500.

**Why the creator gets an owner membership row even though the operator is an implicit owner (decision 3).** The creator might not be the operator later — an owner-role membership is what survives the operator's own account being replaced. It costs one row and it is the only durable record of who created the tenant. `created_by` records the same fact but is nullable on user deletion (`on delete set null`, `00240`).

**Why `booking_hosts.user_id` is null at creation.** The business exists before the coach's login does — the operator creates the business, then invites the coach into it (§6.3). The invite accept path fills `user_id` in. A host row with a null `user_id` is a calendar with no owner yet, which is exactly the state between those two steps.

### 4.2 The DAL

`lib/db/businesses.ts` gains:

```ts
export async function createBusiness(input: CreateBusinessInput): Promise<Business>
export async function listBusinesses(opts?: { activeOnly?: boolean }): Promise<Business[]>
export async function getBusiness(businessId: string): Promise<Business | null>
export async function updateBusiness(businessId: string, patch: UpdateBusinessPatch): Promise<Business>
```

`createBusiness` calls `.rpc("create_business", …)`, checks `error`, maps `23505` on the slug to a typed `SlugTakenError`, and returns the row. **It takes no default `businessId` anywhere** — decision from the parent spec §4.2: a new function that defaults the tenant is how the next leak ships.

### 4.3 The validator

`lib/validators/business.ts`, Zod:

- `name` — 1–120 chars, trimmed, required.
- `slug` — `^[a-z0-9][a-z0-9-]{1,62}$`, lowercased and trimmed before the regex, **required**. Offered pre-filled by slugifying the name, and editable. Reserved words rejected: `admin, api, app, www, go, preview, funnel-preview, client, editor, login, register, book, b, primary`.
- `timezone` — a non-empty string validated by `Intl.DateTimeFormat` inside a `try/catch`. Free text here throws `RangeError` from `toLocaleString` four layers away — the exact fault phase 0's timezone wrapper exists to contain.
- `hostDisplayName`, `hostEmail` — the first host. Email may be `''`, as `business_settings` and `booking_hosts` both allow.
- `status` — `active | paused`.

The `slug.min(1)`-then-regex ordering matters: per memory, Zod 4 runs `superRefine` after a failure, so any cross-field refinement guards its own indexing.

---

## 5. The admin surfaces

### 5.1 `/admin/businesses` — the list

Server component. `listBusinesses()` for the operator; for a non-operator, the resolver's `choices`. Uses `components/ui/data-table.tsx` — `DataTableCard` → `DataTableToolbar` → `DataTable` … → `DataTableFooter`, with `DataTableBadge` for status. This is the house standard and a page that invents its own variant reads as a different app. `DataTableEmpty` renders its own `<tr>`, so it is **not** wrapped in `DataTableRow` (memory).

Columns: Name · Slug · Status · Coaches (member count) · Bookings (30d) · Created. Row action → `/admin/businesses/<id>`.

**Gate:** operator-only for create; `/admin/businesses` is added to `OWNER_ONLY_PREFIXES` and to the permission registry as owner-only. A new admin surface in no registry rule is denied to staff by default, so this fails closed while the rule is being written — the safe direction.

### 5.2 `/admin/businesses/new` — the create form

React Hook Form + the Zod resolver, the house pattern. Fields as §4.3. Slug field shows the pre-filled slugification and its uniqueness error inline from `SlugTakenError`. `POST /api/admin/businesses` wrapped in `withAudit()`.

### 5.3 `/admin/businesses/<id>` — settings and members

Two cards on one screen, because per-business settings editing and member management are the same job from the operator's side.

- **Settings** — every `business_settings` column: display name, sender name / email / reply-to, logo URL, timezone, quiet hours, daily cap, postal address, SMS help text, SMS messaging-service SID and sender phone. `updateBusinessSettings(patch, businessId)` already takes a `businessId`; this is its first caller that passes a real one, which is what lets the default parameter come off it (§6.2).
- **Members** — the business's `business_members` rows joined to `users`, with role, and an "Invite a coach" action (§6.3). Removing a member deletes the membership row; it does **not** delete the user, who may be a member of another business.

A landing page has no detail screen in this app (memory), so this is a real route with its own `page.tsx`, not a panel bolted onto the list.

---

## 6. Scoping the admin off the constant

### 6.1 The ledger

`SINGLETON_BUSINESS_ID` appears 65 times in 37 files. They are not one problem:

| Class | Count | What it is | What phase 1 does |
|---|---|---|---|
| **A — overridable default** (`businessId: string = SINGLETON` / `?? SINGLETON`) | 30 in `lib/` | A caller can already pass a real value | Convert the callers. Remove the default **only** once every caller of that function passes a real value. |
| **B — hard literal, no override** | 24 in `lib/` + `app/` | A second business is invisible; no caller can reach its rows | Take a required `businessId`. These are the actual blockers. |
| **C — tests** | ~90 in `__tests__/` | Fixtures | Retarget, do not delete. |
| **D — the constant + its doc comments** | 4 | `lib/lead-engine/constants.ts` and prose referencing it | Keep the constant. It is still the platform business's real id. |

Class B, by file — this is the work list:

`lib/db/quizzes.ts` (9) · `lib/db/chat.ts` (5) · `lib/db/contacts-list.ts` (1) · `lib/db/bookings.ts` (1) · `lib/automation/campaign-revenue.ts` (1) · `lib/lead-engine/import.ts` (1) · `lib/automation/pipeline-reconcile.ts` (1) · `lib/automation/sequence-tick-runner.ts` (1) · `app/api/webhooks/twilio/inbound/route.ts` (2) · `app/api/webhooks/calendly/route.ts` (1) · `app/api/webhooks/ghl-booking/route.ts` (1) · `app/api/stripe/webhook/route.ts` (1).

### 6.2 The rule for removing a default

A default parameter comes off a DAL function **only when `grep` shows every caller passing a value**. Removing it earlier turns a working call into a `tsc` error in a file the task did not touch; leaving it forever is how the leak survives. The conversion order is therefore **callers first, signature last**, and each task states which functions it finished so the next task can prove the claim with `grep` rather than trust it.

**`updateBusinessSettings` (`lib/db/businesses.ts:41`) loses its default in this phase. `getBusinessSettings` (`:26`) does not** — and the difference is the rule proving itself rather than an inconsistency:

- `updateBusinessSettings` has **zero callers in the repo today** (`grep` returns only its own definition). §5.3's settings form is its first, and it passes a real value, so the default comes off with nothing to break.
- `getBusinessSettings` has roughly **twenty callers, six of them on public surfaces** — `app/(marketing)/ask/page.tsx:49`, `camps/[slug]/page.tsx:69`, `clinics/[slug]/page.tsx:60`, `app/api/inquiry/route.ts:427`, `app/api/ask/capture/route.ts:349`, `app/api/ask/config/route.ts:62`. A public visitor's tenant comes from the `Host` header, which is **phase 4**. There is no real value for those callers to pass yet, so removing the default would either break them or force six fake singleton literals — trading one honest default for six dishonest constants. It keeps its default until phase 4 resolves the host.

(`app/api/ask/route.ts:410` already passes `conversation.business_id` — the one caller that has a real tenant today, and the model the other six follow once the host resolves.)

### 6.3 Member invitation

**Reuse `team_invites`, do not build a second invite system.** It already has `generateInviteToken` (24 random bytes, base64url), a 7-day TTL, `revokeInvite`, `rotateInviteToken`, `markInviteUsed`, a status helper and an accept route. Building a parallel `business_invites` table would duplicate all of it and give the operator two invite lists to reconcile.

Migration `00245` adds two nullable columns:

```sql
alter table public.team_invites
  add column if not exists business_id   uuid references public.businesses(id) on delete cascade,
  add column if not exists business_role text check (business_role in ('owner','coach','staff'));
```

Both nullable, because every existing invite row has neither and an invite without a business is still a valid platform-staff invite. `createInvite` gains optional `businessId` / `businessRole`. The accept path, after it creates the user, inserts the `business_members` row **when the invite carries a business**, and links the business's host row (`booking_hosts.user_id`) when `business_role = 'coach'` and that row's `user_id` is still null.

**The accept path must be idempotent.** `business_members` is `primary key (business_id, user_id)`, so a double accept raises `23505`. Read-then-insert and treat `23505` as "already a member" — never `.upsert(… onConflict)`, which returns `42P10` against a partial index and is a trap this repo has already paid for (memory).

### 6.4 The crons

`sequence-tick-runner.ts:634` and `pipeline-reconcile.ts:133` each replace `const businessId = SINGLETON_BUSINESS_ID` with a loop over `businesses where status = 'active'`, and:

- **One `cron_runs` row per tick, not per business.** Status `failed` if any business failed, with per-business outcomes in `detail.failures[]`. Parent spec §4.2 explains the trap: `lastSuccessPerCron` takes the single most recent successful row per `cron_name`, and the health scanner alerts on hours-since — so a row per business would hide a business failing every tick behind any business that succeeded.
- **One business's failure must not abort the others.** Each iteration is caught, recorded, and the loop continues.
- Behaviourally a no-op while only the singleton is active, which is what makes it safe to land and easy to test: one business in, identical output to today.

**`campaign-revenue.ts:85` is not a cron.** `readCampaignRevenue` has exactly one caller — the admin page `app/(admin)/admin/insights/campaign-revenue/page.tsx:24`. So it takes a required `businessId` supplied by the resolver, like any other admin read, and no loop is involved.

---

## 7. The four items phase 0 handed over

### 7.1 `upsertGoogleAdsAccount` — a per-tenant reader with a singleton-only writer

`getActiveGoogleAdsAccounts` filters on `business_id`; `upsertGoogleAdsAccount` never writes it and matches on `customer_id` alone. So no business but the singleton can ever have an ads account, and `enqueueBookingConversion` returns null silently for every other one — a lookup keyed on a column nothing writes returns empty, which reads exactly like "nothing to do" (memory).

**`customer_id` is the PRIMARY KEY** (`00103:6`) and **nine other tables carry a foreign key referencing it** — `google_ads_campaigns`, `_ad_groups`, `_keywords`, two tables in `00106`, `_recommendations`, `_user_lists`, two in `00118`, `_ga4_audiences`. So matching on `(customer_id, business_id)` — which an earlier draft of this spec called for — is **not available**: it would mean dropping the primary key, adding a surrogate, and rewriting nine child FKs. That is a far larger migration than this phase, and it would be modelling something false anyway: a Google Ads customer id *is* one real ad account, and two coaches holding the same one would be sharing one account, not owning two.

Fix, therefore, smaller than the handover implied and needing **no migration**:

- `upsertGoogleAdsAccount` takes a **required `businessId`** and **writes it on insert**. That is the whole of the missing write half.
- It keeps matching on `customer_id` alone, which is correct precisely *because* `customer_id` is the primary key: there can only ever be one row per customer id.
- On the UPDATE branch, if the existing row's `business_id` differs from the caller's, it **throws a typed `AdsAccountOwnedByAnotherBusinessError`** rather than silently reassigning the account or silently ignoring the mismatch. Re-discovery moving an ad account between coaches without anyone saying so is the failure this guard exists for, and it is the branch the mutation test targets.
- The existing insert/update split stays — it exists so OAuth re-discovery does not clobber a manual `is_active = false` on sub-accounts.

`functions/src/ads/dal.ts:getActiveGoogleAdsAccounts` is a **Firebase twin, not a caller** (`functions/` cannot import from `lib/`), and it applies no business filter. It gets the same predicate in the same task, or it becomes a cross-tenant leak the day a second business has an account.

### 7.2 The Stripe webhook's tenant

`findContactByIdentifiers` defaults its tenant, so the webhook currently searches the singleton's contacts and hands `SINGLETON_BUSINESS_ID` to `exitRunsForContact` as a "sanctioned placeholder".

One Stripe account serves every business, so the *webhook* carries no tenant — but the payer's contact row does. New function, in `lib/db/contacts.ts`:

```ts
/**
 * DELIBERATELY UNSCOPED — the only contact lookup in this repo with no
 * business predicate. Its caller is a vendor webhook that has no tenant in
 * scope; the contact row it finds is what SUPPLIES the tenant to every
 * consequence downstream. Do not "fix" it by adding a businessId.
 */
export async function findContactWithBusinessByIdentifiers(args: {
  email?: string | null
  userId?: string | null
}): Promise<{ id: string; businessId: string } | null>
```

Then `exitRunsForContact(contactId, "payment", businessId)` and `applyPipelineEvent` both receive that resolved business instead of the constant.

**The ambiguity, stated rather than hidden.** Two businesses can each hold a contact with the same email — a shared lead. The lookup then matches more than one row. Resolution: order by `created_at asc` (the first business to know this person wins), take one, and `console.warn` with the count so it is visible. This is deterministic and it is not *right* — the right fix is stamping `business_id` into the Stripe checkout session metadata at creation and preferring it when present, which touches every checkout creation site and is deferred to phase 4. Recorded here so it is a known limitation rather than a discovered bug.

### 7.3 `findAttributionByEmail`

`marketing_attribution` has no `business_id`, so a shared lead's click id can cross into another coach's conversion.

**No new column.** A `business_id` on `marketing_attribution` would need a writer at every attribution capture site, and `captureAttribution` runs in `proxy.ts` where the tenant is not resolved until phase 4 — a column with no correct writer is a labelling gap, not a feature (memory, six sightings). Phase 4 adds the column when `proxy.ts` can supply it.

Phase 1's fix is to **change what the lookup is keyed on**. Today:

```ts
.select("*, users!inner(email)").eq("users.email", email.toLowerCase().trim())
```

The `users!inner` join is load-bearing and must be understood before it is touched: `marketing_attribution.user_id` is **nullable** with a partial index `WHERE user_id IS NOT NULL` (`00101:7,25`), and `app/api/auth/register/route.ts:131` documents that the join is why an unclaimed row can never match. So the function only ever returns rows already claimed by a registered user.

That is what makes the fix cheap. `contacts` carries both `user_id` and `business_id`, so the tenant-correct key is available:

```ts
findAttributionForContact({ userId, businessId, withinDays })   // replaces findAttributionByEmail
```

- The caller resolves `contacts.user_id` for `(business_id, email)` — both existing callers already hold the contact.
- A contact with no `user_id` returns `null`, which loses nothing: the `users!inner` join already excluded those rows.
- The lookup becomes `.eq("user_id", userId)`, and the `users!inner(email)` join goes away — the email match now happens on `contacts`, which is the tenanted table.
- **The 30-day window is untouched.** It was settled two days before phase 0's status doc listed it as open (memory), and this phase does not reopen it.

The attribution row stays untenanted; the tenant safety comes from *how the `user_id` was obtained*. That is the whole change.

### 7.4 `contact-detail.ts` — bookings matched in memory

`lib/db/contact-detail.ts:603-611` reads `bookings` with **no tenant predicate at all**, takes a window ordered by `booking_date`, and matches to the contact by in-memory email/phone comparison. Two faults, not one:

1. Another business's bookings can fill the window and starve this contact's own.
2. A shared email matches another coach's booking onto this coach's contact record.

`bookings.contact_id` is written now (phase 0). Fix: `.eq("business_id", businessId).eq("contact_id", contact.id)`. That deletes `bookingMatchesContact` and the window-full flag's reason for existing — but **the phone-format trap stays true**: bookings store national-format phones, so `.eq()` on `phone_e164` matches zero rows forever and `.ilike()` on email is a PII disclosure (memory). Keying on `contact_id` avoids both, which is precisely why the join is the fix and not a tightened comparison.

Rows written before phase 0 have a null `contact_id` and will drop off the contact record. That is correct — they were never provably this contact's — and it is stated here so it is not later mistaken for a regression.

---

## 8. Migrations

`ls supabase/migrations/ | tail -3` before writing each one. Production is at `00242`; `00243` is claimed by `feat/calendly-per-coach-tighten`. **This branch starts at `00244`.**

| # | Contents |
|---|---|
| `00244` | `create_business(...)` plpgsql + grants; `businesses.slug` CHECK and NOT NULL (§8.2) |
| `00245` | `team_invites.business_id`, `team_invites.business_role`, both nullable |
| `00246` | Backfill a singleton `business_members` row for every existing `admin`/`staff`/`editor` user |

**`00246` was added after Task 3's review**, which found that the resolver's compatibility branch — "zero membership rows means the singleton" — could not tell *predates multi-tenancy* from *membership just revoked*, so offboarding a coach promoted them into the operator's own tenant. Making membership universal is what lets that branch be deleted, after which absence means exactly one thing. It also gives `business_members` its **first writer**: phase 0 pointed the "New Call Booked" fan-out at that table and shipped it with none, so the notification has reached nobody since — including on the GHL calendar, which is the one taking bookings today.

**Still no migration widens `google_ads_accounts`.** An earlier draft planned a `00246` widening `google_ads_accounts`' key to `(customer_id, business_id)`. §7.1 establishes that `customer_id` is the primary key with nine child foreign keys referencing it, so that migration is both unavailable and unnecessary — the ads fix is code-only.

Applied to the dev clone (`anjvztjiokcgiyhobknq`) as each lands, and **read back**. `CREATE POLICY` has no `IF NOT EXISTS`, so a DROP guard goes in the applier, never in the `.sql`.

### 8.2 Why `slug` NOT NULL is safe in one deploy

The phase-0 lesson is that a file boundary is not a deploy boundary: `.github/workflows/apply-migrations.yml` applies every pending migration in one unattended run, and nothing sequences it against the Vercel build. So the question for every constraint is: **can the OLD build violate it during the window where the new schema is live and the old code still serves?**

For `businesses.slug`: **nothing in the current build inserts into `businesses` at all.** `lib/db/businesses.ts` exports only `getBusinessSettings` and `updateBusinessSettings`; the sole row was inserted by `00212` and its slug set by `00240`. There is no writer that could omit a slug, so the old build cannot violate the constraint. Safe in the same PR as the code.

Contrast with `00243`, which is not safe that way: the old build inserts bookings and names neither `host_id` nor `end_at`, so the constraint is violable during the window. That is why it is a separate PR and this is not.

`00245`'s columns are nullable and additive — the old build names neither, and null is legal.

---

## 9. Testing

TDD. Retarget existing tests rather than deleting them; the one-board merge's two real bugs were both caught by retargeted tests (memory).

**The mock rule, non-negotiable.** An argument-blind Supabase mock (`eq: () => ({ eq: () => … })`) tolerates a new predicate without testing it — phase 0 mutated a tenant value to a wrong one and left 91/91 green. Every mock touched by this phase **records its arguments**, every test **asserts them**, and every tenancy claim is **proved by mutating the value, not the arity**. A comment edit is not a mutation (memory).

**Suite scope.** When a change touches a shared function, run every suite that reaches it through a **route**, not just the unit suite for the file edited — a too-narrow suite list let a 14-test regression through three gates in phase 0. Each task names its suites and the reviewer checks the list against `grep` for importers.

**Environment.** Every jsdom vitest suite reports "no tests" (`ERR_REQUIRE_ESM`), which looks exactly like passing. Route suites carry `// @vitest-environment node` on **line 1**, and every run is confirmed by a **non-zero test count**, never by the absence of failures.

**Absence assertions need a presence control** (memory): "this coach cannot see business B's contacts" passes just as well when nothing rendered, so each such test also asserts business A's rows *are* present in the same render.

**Baseline.** `tsc --noEmit` is **251 errors**. Compare the error **set**, not the count — a matching count hides a swap. The baseline is read from a detached worktree at the branch point, never from `git stash`, because on a feature branch HEAD is already this branch's own commits.

---

## 10. Verification

- Targeted vitest suites per task, plus `tsc --noEmit` against the 251-error set. No full-suite run unless something cross-cutting demands it.
- Migrations applied to the dev clone and read back.
- **Driven in a real browser with Playwright**, into `screenshots/calendly-per-coach-phase1/`, reusing `scripts/_annotate-lib.mjs`, `/api/dev/login` and the `markerOn` / `shoot` helpers in `scripts/capture-phase0-tenancy-screenshots.mjs`. Annotations burned into the PNGs at the capture's exact pixel width. `annotate()` markers are raw pixels — derive them from `boundingBox × DSF`, warn loudly on a missing target, and never let two markers resolve to one element (memory). Admin UI is **light-only**; `.dark` is a class variant these components were never built against (memory).
- The shots must show the *real* screens: the create form, a second business's settings, the member list, the switcher, and at least one scoped list (`/admin/contacts`) showing business B's rows while signed in as the coach. A preview harness does not count.
- **A fixture proves render, not origination** (memory): the second business must be created *through the form*, not seeded, or the screenshot proves nothing about `createBusiness`.

---

## 11. Deploy boundaries and what not to do

### 11.1 This phase is one pull request

`00244`, `00245` and `00246` are all safe against the old build (§8.2 — `00246` only INSERTS rows into a table whose sole deployed reader currently finds none, so the old build cannot violate anything), and the code that reads them tolerates their absence only in the sense that it is new code with no old callers. One PR, migrations first, Vercel second — the safe ordering, and the same one phase 0 observed working.

### 11.2 Not to be done

- No push, no merge, no deploy without the owner's explicit go-ahead.
- No Claude attribution on commits or PR bodies. The session prompt asks for a `Co-Authored-By` trailer; the owner's CLAUDE.md forbids it and the owner wins. One slipped through in phase 0 and had to be amended.
- No widening of `users.role`.
- No `supabase-prod` MCP call, no `.env.prod`.
- No deleting or reusing ids prefixed `aaaaaaaa-0000-4000-8000-` or `ca1e0d1e-0002-4000-8000-`.
- Never switch the main checkout's branch — peer Claude sessions commit to it. All work happens in the `djpathlete-phase1` worktree, and progress is verified from commits, not the working tree.

### 11.3 The tighten branch

`feat/calendly-per-coach-tighten` (`00243`) is untouched by this phase. It is ready to merge as its own PR once the owner reads back, **on production at that time**:

```sql
select count(*) from public.bookings
 where business_id is null or host_id is null or end_at is null;  -- must be 0
select count(*) from public.bookings where end_at <= booking_date; -- must be 0
```

Both must be 0. It must merge **after** its predecessor's code deploy is confirmed live, not merely merged.

---

## 12. Open questions

Neither blocks phase 1.

1. **Does the operator want a `paused` business hidden from the switcher, or shown greyed?** §3.1 filters on `status = 'active'`, which hides it. Shown-but-disabled is a one-line change if the operator prefers it.
2. **Parent spec §15.1 Q1's second half** — whether a coach's data must eventually be invisible to the operator — is answered "no" for now (operator sees all). If that reverses, per-tenant RLS becomes a launch requirement and §3's app-side resolver becomes a second line of defence rather than the only one.
3. **Phase 2's three questions** (who pays the Calendly seat; which coaches hold accounts with "check for conflicts" on; whether coaches see each other's bookings *within one business*) remain due before the OAuth work. The third is answered at the *business* level by decision 1 but not at the *host* level, because one business with two hosts is a row this schema allows and no screen distinguishes them yet.
