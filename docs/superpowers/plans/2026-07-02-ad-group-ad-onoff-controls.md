# Ad-Group & Ad On/Off Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Let an admin enable/disable (resume/pause) individual **ad groups** and **ads** from `/admin/ads/campaigns`, writing the change to the live Google Ads account — mirroring the existing campaign pause/resume. Solves the "Not eligible / ads aren't showing" state on the 4 program campaigns whose ad groups + ads are all paused.

**Design (approved scope):** Extend the proven campaign-status vertical slice one and two levels down. Reuse `mutateResourcesRest` (already maps `ad_group → adGroupOperation`, `ad_group_ad → adGroupAdOperation`) and `isRemovedResourceError` self-heal. The campaigns page currently renders only campaigns; add an expandable drill-down (campaign → its ad groups → their ads), each row carrying a status toggle. No feature flag (admin-only tool, like the existing campaign toggles). App-only change (Vercel; no `functions/**`).

**Reference files to mirror (read them — do not reinvent):**
- Route: `app/api/admin/ads/campaigns/[id]/status/route.ts`
- REST + `isRemovedResourceError`: `lib/ads/google-ads-rest.ts`
- Toggle UI: `app/(admin)/admin/ads/campaigns/CampaignStatusToggle.tsx`
- Table: `app/(admin)/admin/ads/campaigns/CampaignsTable.tsx`
- DAL patterns: `lib/db/google-ads-campaigns.ts` (`getCampaignById`, `setCampaignStatus`, `listAllCampaigns`); existing joins in `lib/db/google-ads-ads.ts` (`resolveAdExternalIds`) and `lib/db/google-ads-ad-groups.ts` (`resolveAdGroupByExternalId`).

## Global Constraints

- **No `git add -A`** (repo has stray untracked files). Stage explicit paths. Never stage `JOURNAL.md`/`.superpowers/`.
- `/api/*` is NOT in middleware — both new routes MUST self-gate `session.user.role !== "admin"` → 403.
- Body schema `{ status: z.enum(["ENABLED","PAUSED"]) }`. REMOVED is never accepted (destructive → Google Ads UI only), and a row already `REMOVED` → 409.
- Resource-name construction: prefer `ResourceNames.adGroup(customerId, adGroupIdExternal)` and `ResourceNames.adGroupAd(customerId, adGroupIdExternal, adIdExternal)` from `google-ads-api`. **Verify these helpers exist** (the campaign route uses `ResourceNames.campaign`). If a signature differs, fall back to manual strings: `customers/${cid}/adGroups/${agId}` and `customers/${cid}/adGroupAds/${agId}~${adId}` (the `~` form is confirmed in `resolveAdExternalIds`'s doc comment).
- Every successful/failed mutate records an audit row (mirror the campaign route's `recordAudit` calls).
- App tests from root: `npx vitest run <pattern>`. tsc: `npx tsc --noEmit` — ~160-line pre-existing baseline expected; changed files add ZERO new errors.
- Commit after each task: `feat(ads-onoff): …`.
- Types already exist: `GoogleAdsAdGroup`, `GoogleAdsAd`, `GoogleAdsResourceStatus` in `types/database.ts`.

---

### Task A: DAL — getForMutation + setStatus + listAll (ad groups & ads)

**Files:**
- Modify: `lib/db/google-ads-ad-groups.ts`
- Modify: `lib/db/google-ads-ads.ts`
- Test: `__tests__/lib/db/google-ads-onoff-dal.test.ts`

**Interfaces produced:**
- `getAdGroupForMutation(id): Promise<AdGroupForMutation | null>` where `AdGroupForMutation = { id; ad_group_id; name; status; customer_id }`
- `setAdGroupStatus(id, status): Promise<void>`
- `listAllAdGroups(): Promise<GoogleAdsAdGroup[]>`
- `getAdForMutation(id): Promise<AdForMutation | null>` where `AdForMutation = { id; ad_id; status; ad_group_id_external; customer_id; headline: string | null }`
- `setAdStatus(id, status): Promise<void>`
- `listAllAds(): Promise<GoogleAdsAd[]>`

- [ ] **Step 1: Add to `google-ads-ad-groups.ts`**

```ts
export interface AdGroupForMutation {
  id: string
  ad_group_id: string // external Google id
  name: string
  status: GoogleAdsResourceStatus
  customer_id: string // from joined campaign
}

export async function getAdGroupForMutation(id: string): Promise<AdGroupForMutation | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_ad_groups")
    .select("id, ad_group_id, name, status, campaign:google_ads_campaigns!inner(customer_id)")
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as unknown as {
    id: string; ad_group_id: string; name: string; status: GoogleAdsResourceStatus
    campaign: { customer_id: string }
  }
  return {
    id: row.id, ad_group_id: row.ad_group_id, name: row.name, status: row.status,
    customer_id: row.campaign.customer_id,
  }
}

export async function setAdGroupStatus(id: string, status: GoogleAdsResourceStatus): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("google_ads_ad_groups").update({ status }).eq("id", id)
  if (error) throw error
}

export async function listAllAdGroups(): Promise<GoogleAdsAdGroup[]> {
  const supabase = getClient()
  const { data, error } = await supabase.from("google_ads_ad_groups").select("*").order("name")
  if (error) throw error
  return (data ?? []) as GoogleAdsAdGroup[]
}
```

- [ ] **Step 2: Add to `google-ads-ads.ts`**

```ts
export interface AdForMutation {
  id: string
  ad_id: string // external Google id
  status: GoogleAdsResourceStatus
  ad_group_id_external: string // from joined ad_group
  customer_id: string // from joined ad_group.campaign
  headline: string | null // first headline text, for display/audit label
}

export async function getAdForMutation(id: string): Promise<AdForMutation | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from("google_ads_ads")
    .select("id, ad_id, status, headlines, ad_group:google_ads_ad_groups!inner(ad_group_id, campaign:google_ads_campaigns!inner(customer_id))")
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as unknown as {
    id: string; ad_id: string; status: GoogleAdsResourceStatus
    headlines: Array<{ text: string }> | null
    ad_group: { ad_group_id: string; campaign: { customer_id: string } }
  }
  return {
    id: row.id, ad_id: row.ad_id, status: row.status,
    ad_group_id_external: row.ad_group.ad_group_id,
    customer_id: row.ad_group.campaign.customer_id,
    headline: row.headlines?.[0]?.text ?? null,
  }
}

export async function setAdStatus(id: string, status: GoogleAdsResourceStatus): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from("google_ads_ads").update({ status }).eq("id", id)
  if (error) throw error
}

export async function listAllAds(): Promise<GoogleAdsAd[]> {
  const supabase = getClient()
  const { data, error } = await supabase.from("google_ads_ads").select("*").order("ad_id")
  if (error) throw error
  return (data ?? []) as GoogleAdsAd[]
}
```

- [ ] **Step 3: Test** (`__tests__/lib/db/google-ads-onoff-dal.test.ts`) — mock `@/lib/supabase`'s `createServiceRoleClient` with a chainable builder (see `__tests__/lib/db/exercise-favorites.test.ts` for the established shape). Assert: `getAdGroupForMutation` flattens `campaign.customer_id` to `customer_id`; returns null when row missing; `getAdForMutation` flattens `ad_group.ad_group_id` → `ad_group_id_external` and `ad_group.campaign.customer_id` → `customer_id` and first headline → `headline`; `setAdGroupStatus`/`setAdStatus` issue an update. Use valid data; no uuid validator here so ids can be simple strings.

- [ ] **Step 4:** `npx vitest run __tests__/lib/db/google-ads-onoff-dal.test.ts` → PASS. `npx tsc --noEmit` → no new errors.

- [ ] **Step 5: Commit** — `git add lib/db/google-ads-ad-groups.ts lib/db/google-ads-ads.ts __tests__/lib/db/google-ads-onoff-dal.test.ts && git commit -m "feat(ads-onoff): DAL getForMutation/setStatus/listAll for ad groups + ads"`

---

### Task B: Status routes + audit slugs (ad groups & ads)

**Files:**
- Modify: `lib/audit/actions.ts` (2 slugs)
- Create: `app/api/admin/ads/ad-groups/[id]/status/route.ts`
- Create: `app/api/admin/ads/ads/[id]/status/route.ts`
- Test: `__tests__/api/admin/ads-onoff-routes.test.ts`

**Interfaces consumed:** Task A DAL; `mutateResourcesRest`, `isRemovedResourceError` from `@/lib/ads/google-ads-rest`; `ResourceNames` from `google-ads-api`; `recordAudit`.

- [ ] **Step 1: Audit slugs** — in `lib/audit/actions.ts`, after `ads.campaign_renamed`:

```ts
  { slug: "ads.ad_group_status_changed", category: "admin_write", description: "Google Ads ad group paused or resumed from admin UI" },
  { slug: "ads.ad_status_changed", category: "admin_write", description: "Google Ads ad paused or resumed from admin UI" },
```

- [ ] **Step 2: Ad-group route** (`app/api/admin/ads/ad-groups/[id]/status/route.ts`) — copy `campaigns/[id]/status/route.ts` and adapt: use `getAdGroupForMutation`/`setAdGroupStatus`; resource = `ResourceNames.adGroup(row.customer_id, row.ad_group_id)`; op `{ entity: "ad_group", operation: "update", resource, status: nextStatus, update_mask: "status" }`; audit `ads.ad_group_status_changed` with `target: { type: "google_ads_ad_group", id, label: row.name }` and metadata `{ customer_id, ad_group_id: row.ad_group_id, from, to }`. Keep the same 403/404/409-REMOVED/noop/`{removed:true}` flow.

- [ ] **Step 3: Ad route** (`app/api/admin/ads/ads/[id]/status/route.ts`) — same shape with `getAdForMutation`/`setAdStatus`; resource = `ResourceNames.adGroupAd(row.customer_id, row.ad_group_id_external, row.ad_id)`; op `{ entity: "ad_group_ad", operation: "update", resource, status: nextStatus, update_mask: "status" }`; audit `ads.ad_status_changed` with `target: { type: "google_ads_ad", id, label: row.headline ?? row.ad_id }` and metadata `{ customer_id, ad_id: row.ad_id, from, to }`.

- [ ] **Step 4: Test** (`__tests__/api/admin/ads-onoff-routes.test.ts`) — mock `@/lib/auth`, the two DAL modules, `@/lib/ads/google-ads-rest` (`mutateResourcesRest` as a spy, `isRemovedResourceError` real or stubbed), `@/lib/audit/record`. Cover for BOTH routes:
  - 403 for non-admin.
  - 404 when `getFor Mutation` returns null.
  - Happy path: `mutateResourcesRest` called once with `customer_id` and an op whose `entity` is `ad_group`/`ad_group_ad`, `operation:"update"`, `update_mask:"status"`, `status:"PAUSED"`; then `setAdGroupStatus`/`setAdStatus` called with `(id,"PAUSED")`; response `{ ok:true }`.
  - noop when current status already equals requested.
  - removed self-heal: make `mutateResourcesRest` reject with a message containing `OPERATION_NOT_PERMITTED_FOR_REMOVED_RESOURCE` → route returns 409 `{ removed:true }` and calls `setAdGroupStatus`/`setAdStatus`(id,"REMOVED").
  Params are Next 16 async: pass `{ params: Promise.resolve({ id: "…" }) }`.

- [ ] **Step 5:** `npx vitest run __tests__/api/admin/ads-onoff-routes.test.ts` → PASS. `npx tsc --noEmit` → no new errors (confirm `ResourceNames.adGroup`/`adGroupAd` type-check; if not, use manual strings).

- [ ] **Step 6: Commit** — stage the 2 routes + actions.ts + test → `git commit -m "feat(ads-onoff): ad-group + ad status routes + audit slugs"`

---

### Task C: Generic ResourceStatusToggle component

**Files:**
- Create: `app/(admin)/admin/ads/campaigns/ResourceStatusToggle.tsx`
- Test: `__tests__/components/admin/ResourceStatusToggle.test.tsx`

**Interface produced:** `<ResourceStatusToggle endpoint resourceKind resourceName initialStatus />` where `resourceKind: "ad group" | "ad"`.

- [ ] **Step 1: Test first** — render with `initialStatus="ENABLED"`; the toggle button shows status; clicking opens the confirm dialog; confirming optimistically flips to PAUSED and POSTs to `endpoint` with `{ status: "PAUSED" }`; on `!res.ok` non-removed → reverts to ENABLED + toast.error; on `{ removed:true }` 409 → shows REMOVED. Mock `next/navigation` (`useRouter().refresh`), `sonner`, and `global.fetch`. Query the trigger by `aria-label` containing the resourceKind.

- [ ] **Step 2: Component** — port `CampaignStatusToggle.tsx` verbatim, parameterized: replace `campaignId`/`campaignName` props with `endpoint`/`resourceName`/`resourceKind`; POST to `endpoint` (not the hardcoded campaign URL); confirm-dialog copy uses `resourceKind` ("Pause this ad group?" / "Resume this ad?"); keep the exact REMOVED badge, optimistic set, `body.removed` reconcile, revert-on-error, `router.refresh()`, `useTransition`, `AlertDialog`, and `BADGE_CLASSES`. `aria-label={`${verb} ${resourceKind} ${resourceName}`}`.

- [ ] **Step 3:** `npx vitest run __tests__/components/admin/ResourceStatusToggle.test.tsx` → PASS. tsc clean.

- [ ] **Step 4: Commit** — `git commit -m "feat(ads-onoff): generic ResourceStatusToggle (ad group + ad)"`

---

### Task D: Drill-down UI + page data loading

**Files:**
- Create: `app/(admin)/admin/ads/campaigns/AdGroupAdList.tsx`
- Modify: `app/(admin)/admin/ads/campaigns/CampaignsTable.tsx` (expand row + render `AdGroupAdList`)
- Modify: `app/(admin)/admin/ads/campaigns/page.tsx` (load ad groups + ads, build map, pass down)
- Test: `__tests__/components/admin/AdGroupAdList.test.tsx`

**Interfaces consumed:** `ResourceStatusToggle` (Task C); `listAllAdGroups`/`listAllAds` (Task A). Types: `GoogleAdsAdGroup`, `GoogleAdsAd`.

- [ ] **Step 1: Page data** (`page.tsx`) — extend the `Promise.all` to also `listAllAdGroups()` and `listAllAds()`. Build:
```ts
const adsByAdGroup = new Map<string, GoogleAdsAd[]>()
for (const ad of ads) { const arr = adsByAdGroup.get(ad.ad_group_id) ?? []; arr.push(ad); adsByAdGroup.set(ad.ad_group_id, arr) }
const adGroupsByCampaign: Record<string, AdGroupWithAds[]> = {}
for (const ag of adGroups) {
  (adGroupsByCampaign[ag.campaign_id] ??= []).push({ ...ag, ads: adsByAdGroup.get(ag.id) ?? [] })
}
```
Pass `adGroupsByCampaign` to `<CampaignsTable>`. Export `type AdGroupWithAds = GoogleAdsAdGroup & { ads: GoogleAdsAd[] }` from `AdGroupAdList.tsx` and import it here.

- [ ] **Step 2: `AdGroupAdList.tsx`** — `"use client"`. Props `{ adGroups: AdGroupWithAds[] }`. Render nothing/"No ad groups synced." when empty. For each ad group: a row with the ad-group name + `<ResourceStatusToggle endpoint={`/api/admin/ads/ad-groups/${ag.id}/status`} resourceKind="ad group" resourceName={ag.name} initialStatus={ag.status} />`; nested under it, each ad: first headline (`ad.headlines?.[0]?.text ?? ad.ad_id`) + `<ResourceStatusToggle endpoint={`/api/admin/ads/ads/${ad.id}/status`} resourceKind="ad" resourceName={headline} initialStatus={ad.status} />`. Use indentation + muted styling; semantic classes only.

- [ ] **Step 3: `CampaignsTable.tsx`** — add `adGroupsByCampaign: Record<string, AdGroupWithAds[]>` to props. Add `expanded` state (`useState<Set<string>>`). Add a chevron button at the start of the Campaign cell that toggles `expanded` for that campaign id (aria-expanded, aria-label "Show ad groups"). After each campaign `<tr>`, when expanded, render `<tr><td colSpan={9} className="p-0"><div className="px-6 py-3 bg-surface/40"><AdGroupAdList adGroups={adGroupsByCampaign[c.id] ?? []} /></div></td></tr>`. Keep everything else unchanged.

- [ ] **Step 4: Test** (`__tests__/components/admin/AdGroupAdList.test.tsx`) — render `AdGroupAdList` with one ad group (status ENABLED) containing one ad (status PAUSED, one headline); assert the ad-group name and ad headline render, and two toggle buttons exist (one per resource). Mock `next/navigation` + `sonner` + `fetch`. (A full CampaignsTable expand test is optional; keep this focused on the list.)

- [ ] **Step 5:** `npx vitest run __tests__/components/admin/AdGroupAdList.test.tsx` → PASS. `npx tsc --noEmit` → no new errors. `npx next build` → green (campaigns route compiles).

- [ ] **Step 6: Commit** — stage AdGroupAdList, CampaignsTable, page.tsx, test → `git commit -m "feat(ads-onoff): campaign drill-down with ad-group + ad toggles"`

---

### Task E: Verify + review

- [ ] Full app suite `npx vitest run` (only the documented `uploads/shop` baseline reds allowed). `npx tsc --noEmit` (zero new). `npx next build` green.
- [ ] Whole-branch review (adversarial): security (admin gate on both routes; resource-name built from server-side joined ids, never client body), correctness (right entity/update_mask/status; removed self-heal), UI (no nested buttons; optimistic revert), and that campaign behavior is unchanged.

## Self-review (planning)
- Coverage: DAL→A, routes+audit→B, toggle→C, drill-down+page→D, verify→E. All scope items covered.
- Type consistency: `AdGroupForMutation`/`AdForMutation` produced in A, consumed in B; `AdGroupWithAds` produced in D's `AdGroupAdList`, consumed in `page.tsx`+`CampaignsTable`; `ResourceStatusToggle` props consistent C↔D.
- Open confirmations (flagged inline): `ResourceNames.adGroup`/`adGroupAd` existence (fallback: manual strings). `AuditTarget.type` is a plain string (confirmed earlier this session) so `"google_ads_ad_group"`/`"google_ads_ad"` type-check.
