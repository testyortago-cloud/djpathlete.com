# Program library and weekly release — design

Date: 2026-10-05. Branch `worktree-program-library` off `origin/main@e4764e3a`.

## What the owner asked for

> Put some of my programs into a folder or category so I can build up ones already made and keep them
> separate, so I can just copy one and give it to someone new — with the option to unsee certain weeks.
> For example, a pre-created 12-week program: I send it to someone, and they might think "I've only
> paid for one week, so I can cancel my subscription and have all this now".

Decisions the owner made while brainstorming:

- **Unlocking:** automatic weekly release plus manual control. The client starts with week 1, and one more
  week appears every 7 days while their access is running. Cancelling stops new weeks. The coach can show
  or hide any single week by hand.
- **Organisation:** a separate **Library** tab with named folders, one level only. Library programs are
  never shown to clients.
- **Approach:** a library program is an ordinary `programs` row flagged `is_template`. "Give to client"
  makes a full copy and assigns the copy.

## What exists today (and is wrong for this)

- **Assigning shares the row.** `assignProgram` (`lib/services/assign-program.ts:171`) links the client to
  the same `programs` row, so an edit reaches every client on it. There is no whole-program copy:
  `duplicateProgramExercises` (`lib/db/program-exercises.ts:289`) has no callers. The `copy-from` helper
  lists its columns by hand and misses `slot_role`. It also reads with no `.range()`, so it stops
  silently at PostgREST's 1000-row cap.
- **The week lock is cosmetic.** `app/(client)/client/workouts/page.tsx:99` loads every week's exercises
  and passes them to the client component `WorkoutTabs`. That component then draws a "Week N is Locked"
  card over a paid week (`:438-470`), but the exercises are already in the browser. The `session` and
  `log` routes (`app/api/client/workouts/{session,log}/route.ts`) call `assertAssignmentPayable` without a
  week, so a client can log a locked week. `progress/page.tsx:147` and `reassessment/page.tsx:55` load
  every week too.
- **No folders.** `programs.category` is a fixed `text[]` (strength, conditioning, …). It is a training
  type, not a user folder.
- **`programs` has no `business_id`** (G37, noted at `lib/db/programs.ts:11-15`).
- **Assignment status has many writers:** the webhook at `app/api/stripe/webhook/route.ts` lines 1138,
  1274, 1351 and 1390, `PATCH /api/admin/assignments/[id]`, and `lib/funnels/checkout/grant-program.ts`.

## Design

### 1. Schema — migration `00289_program_library_and_week_release.sql`

All changes are additive. Old code keeps working against the new schema, and existing rows behave as
they do today.

```sql
create table public.program_folders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index program_folders_business_name_key on public.program_folders (business_id, lower(btrim(name)));
alter table public.program_folders enable row level security;   -- service-role DAL only, no policies
create trigger set_updated_at before update on public.program_folders
  for each row execute function update_updated_at();

alter table public.programs
  add column is_template boolean not null default false,
  add column folder_id uuid references public.program_folders(id) on delete restrict,
  add constraint programs_template_never_public check (not (is_template and is_public)),
  add constraint programs_template_has_folder
    check ((is_template and folder_id is not null) or (not is_template and folder_id is null));

alter table public.program_assignments
  add column release_base_week integer check (release_base_week >= 1),
  add column release_anchor_at timestamptz;

alter table public.program_week_access
  add column visibility text not null default 'auto' check (visibility in ('auto', 'shown', 'hidden'));
```

- **`release_base_week` null** means there is no schedule and every week is visible. This is what every
  existing assignment gets. **Non-null** means weeks `1..base` were released before `release_anchor_at`.
  After the anchor, one more week is released every 7 days. **`release_anchor_at` null with a base set**
  means the clock is paused.
- **`is_template` is set at creation and never changed.** No PATCH route accepts it. "Save to library"
  copies a program; it never converts one.

**Release-clock trigger.** This lives in the same migration. A `BEFORE INSERT OR UPDATE OF status,
payment_status` trigger on `program_assignments` covers every writer listed above in one place. It does
not rely on each caller remembering to do it.

- A row is *running* when `status = 'active' and payment_status <> 'pending'`.
- If `release_base_week` is null, the trigger does nothing.
- **UPDATE, running → not running, with an anchor set: freeze.** It sets
  `base = base + greatest(0, floor(epoch(now() - anchor) / 604800))` and `anchor = null`. The `greatest`
  matters when the anchor is a future start date. A client who cancels after
  week 1 and returns two months later picks up at week 2, not week 9.
- **UPDATE, not running → running, with no anchor: resume.** It sets `anchor = now()`.
- **INSERT that is not running:** sets `anchor = null`. A program given while payment is pending starts
  its clock when the client pays. The `pending → paid` update resumes it.

The formula also exists in TypeScript (§2). The SQL copy is pinned by `test:integration:drift`, and the
TypeScript copy by unit tests. Both carry a comment naming the other.

### 2. Visibility rule — `lib/programs/week-visibility.ts` (pure)

```ts
releasedThroughWeek(a, now): number | null   // null = no schedule (all weeks)
// = a.release_anchor_at ? base + max(0, floor((now - anchor) / 7d)) : base
//   (max(0, …): an anchor in the future, i.e. a later start date, must not drop below base)

weekState(week, a, access, now): "visible" | "scheduled" | "hidden"
// access.visibility 'hidden' -> hidden;  'shown' -> visible;
// 'auto' -> visible if released === null || week <= released, else scheduled

nextUnlock(a, totalWeeks, accessRows, now): { week: number; date: Date } | null
// first 'auto' week above `released` and <= totalWeeks; date = anchor + (week - base) * 7d;
// null when paused or nothing left to release
```

The existing pay-per-week lock (`access_type='paid'` with `payment_status='pending'`) applies only to
weeks that are `visible`.

### 3. Library — `/admin/programs`

- Two tabs: **Client programs** (today's list, `is_template = false`) and **Library**.
- **Library tab:**
  - On the left: the folder list, plus New / Rename / Delete. **Every library program is in a folder**
    (DB check `programs_template_has_folder`). A folder can be deleted only once it is empty: the
    foreign key is `ON DELETE RESTRICT`, and the button says "Move or delete its programs first".
  - On the right: a `DataTable` (the house standard) of the folder's programs. Row actions: Edit (the
    existing builder at `/admin/programs/[id]`), Move to folder, **Give to client**, and Copy (a new
    library program in the same folder).
  - "New program" in the Library tab opens the existing `ProgramFormDialog`, which posts `folder_id` to
    the existing create route. A valid folder of the tenant makes the new row `is_template = true`; the
    flag is never accepted from the body.
- Every client-program row gets **Save to library**: pick or create a folder, then the program is copied
  in. This is how existing work goes into the library.
- **Readers that exclude templates.** `getPrograms()` feeds the admin list, dashboard, analytics, the
  session-pack picker, the funnel offer catalogue and lead-engine facts. `listGrantablePrograms()`
  feeds the pipeline grant. Both gain `is_template = false`. The public store and `listPublicProgrammes`
  are already covered by the never-public check. `getAllPrograms()` (funnel recognition only) and the
  copy-sources route (the "Copy from another program" dialog, where library programs are useful) keep
  them.
- **Guards:**
  - `assignProgram` throws on a template.
  - Checkout already refuses a private program to anyone without an assignment, and a template never
    has one.
  - `PATCH /api/admin/programs/[id]` forces `is_public = false` on a template.
- **Tenancy:** folders are tenant-scoped through `resolveAdminTenant[ForRequest]`, and every folder query
  filters on `business_id`. Because every template has a folder, `getLibraryPrograms(businessId)` is
  tenant-scoped too: two reads (the tenant's folder ids, then templates in them), not an embed.
  `programs` itself is still untenanted (G37); that is flagged here rather than taken on.

### 4. Copying — `lib/services/copy-program.ts`

`copyProgram(sourceId, overrides)` is the only whole-program copy. It replaces the dead
`duplicateProgramExercises`.

1. Read the `programs` row (`select *`). Insert a new row without `id`, `created_at` and `updated_at`,
   with the overrides applied.
2. Read `program_exercises` in `.range()` pages of 1000, ordered by
   `week_number, day_of_week, order_index, id`. Insert **every column** except `id`, `program_id`,
   `created_at` and `updated_at`, in chunks of 500. Copying every column means a new column is carried
   automatically, which fixes the `slot_role` gap.
3. Copy `program_week_pricing`.
4. If any step after (1) fails, delete the new program, whose rows cascade with it, and rethrow. A
   failed copy never leaves a half-built program behind.

Overrides used by the callers:

| Caller | Overrides |
|---|---|
| Give to client | `is_template=false, folder_id=null, is_public=false`, name from the dialog |
| Save to library | `is_template=true, folder_id=<picked>, is_public=false` |
| Copy within library | `is_template=true`, same folder, name `"<name> (copy)"` |

**Stripe ids are never copied.** This was checked while planning: `PATCH /api/admin/programs/[id]`
archives the old Price when a price changes (`archiveAndCreateNewPrice`) and renames the Product when the
name changes. Two programs sharing those ids would break each other's checkout and relabel each other.
`copyProgram` nulls both ids. The give route creates a fresh product and price for a paid copy with
`createStripeProductAndPrice`, using `programId` = the copy's id.

### 5. Give to client — `POST /api/admin/programs/[id]/give`

- **Dialog fields:**
  - client (search picker)
  - name (default `"<program> – <client first name>"`)
  - start date (default today)
  - **Release one week at a time** (on by default)
  - **Weeks visible at start** (default 1, range 1..duration)
- **Server steps:**
  1. Zod-validate the body. Use the same admin and permission guard as the other program routes.
  2. Load the source and refuse a non-template with 400.
  3. `copyProgram`.
  4. `assignProgram` with the new `releaseBaseWeek` and `releaseAnchorAt` inputs: base = weeks visible
     at start, anchor = `greatest(now, start_date)`, or both null when release is off. The insert
     trigger then nulls the anchor if payment is pending.
  5. If the assignment is skipped or throws, delete the copy and return an error.
  6. Audit `program.given_to_client`.
- `assignProgram` gains these two optional inputs. Every other caller leaves them out and keeps today's
  all-visible behaviour.

### 6. Per-client week control — extend `components/admin/WeekAccessPanel.tsx`

The panel already sits on `/admin/programs/[id]` and lists each active assignment's weeks. A given copy
has one client, so this is the right place for it.

- **A schedule line per assignment:**
  - On: "One new week every 7 days — next: Week 3 on Mon 19 Oct", or "Paused" when the clock is frozen.
  - Off: "All weeks visible".
  - The on/off switch goes through `PATCH /api/admin/assignments/[id]` with `release_schedule: boolean`.
  - **On:** base = the client's `current_week`, anchor = now, or null if not running. Weeks they have
    already seen stay visible.
  - **Off:** base and anchor both null.
- **Each week chip shows its state:** Visible, Unlocks <date>, or Hidden by you. The existing week modal
  gains **Show now** / **Hide** / **Back to schedule**. They write `visibility` through a new
  `set_visibility` action on the existing `POST /api/admin/programs/[id]/week-access`, which also
  checks that the assignment belongs to that program.
- **Audit:** `assignment.release_schedule_changed` and `assignment.week_visibility_changed`.
- `resyncProgramWeekAccess` and the add-week and delete-week paths must keep `visibility` as it is. The
  plan verifies each one.

### 7. Client side — enforced on the server

- **One gate:** `buildWeekGate(assignment, weekAccessRows, totalWeeks, now)` in
  `lib/programs/week-visibility.ts`. It returns `open` (weeks whose workouts may be sent), `locked`
  (visible paid weeks: price only, **no exercises**) and `unavailable` (a scheduled week with its unlock
  date, or a hidden week with none).
  - The workouts page builds week tabs **and the calendar view** (which today lists every week's
    exercise names) only from `open` weeks. A hidden week's workouts never leave the server.
  - `progress` and `reassessment` are left alone, checked while planning. `progress` sends only a
    count of planned days for the current week. `reassessment` reads only a *completed* assignment,
    and only exercise names.
- **`WorkoutTabs`:** the client moves between weeks with previous/next arrows over 1..total, so a week
  can't simply vanish.
  - A scheduled week shows a card: "Week 4 unlocks on Monday, October 19."
  - A week hidden by hand shows: "Week 4 isn't available yet."
  - Neither card carries any workout content.
  - The locked-week Unlock card still works, now from `locked`.
- **`isAccessAllowed`** gains the visibility check. The `session` and `log` routes pass `week_number`
  and answer 403 for a hidden, scheduled or locked week. This also closes today's paid-week gap.
- **Webhook paths:** `handleSubscriptionCheckout` (`:1137`) reactivates an existing assignment. It
  must not touch `release_*`; the trigger resumes the clock. Its create path (`:1145`) and the one-time
  path (`:965`) stay all-visible.

### 8. Out of scope

- Weekly release for programs bought from the public store or a funnel. They stay all-visible; a
  per-program default can come later.
- Nested folders.
- A "your next week is ready" email.
- Adding `business_id` to `programs` (G37).
- Making AI generation save straight into the library. Generate a client program, then Save to library.

### 9. Known limits

- The SQL trigger and the TypeScript rule are twins (§1). Changing one without the other makes the
  admin's "next unlock" date disagree with the frozen base.
- Release time follows the moment of giving or paying, not midnight in the client's time zone. The client
  is shown a date only.
- Two admins changing the same week at once: last write wins. This is acceptable for one coach per
  tenant.

## Testing

- **Unit, `week-visibility`:**
  - no schedule
  - base 1 at day 0, 6 and 7
  - anchor 3 days in the future still shows `base`
  - `shown` above the released week, `hidden` below it
  - paused (anchor null)
  - `buildWeekGate`: open, locked, scheduled-with-date, hidden-without-date, paused-without-date
- **Unit, `copyProgram`:**
  - every exercise column is carried, `slot_role` named
  - 2,300 rows copy across three pages, using a fake that **enforces** the 1000-row cap
  - week pricing is copied
  - a failure after insert deletes the new program
- **Route, `give`:**
  - rejects a non-template
  - the copy is deleted when the assignment is skipped
  - the release inputs reach `assignProgram`
  - audit row written
- **Route, `session` / `log`:** 403 for a hidden and for a scheduled week, 200 for a visible week. The
  200 is the presence control.
- **Real page:** as a client in the dev app, a week-2-only exercise name is absent from
  `/client/workouts`' HTML (which includes the data payload) while a week-1 name is present.
- **Guards:** `assignProgram` throws on a template; `getPrograms()` excludes templates.
- **Trigger:** applied to the dev clone. Probe freeze, resume and pending-insert with scratch rows on the
  clone only, then delete them. Run `npm run test:integration:drift` and
  `npm run test:integration:selects`.
- **Gates:** targeted vitest files plus `tsc --noEmit`, compared against the 236-error baseline. No full
  suite.
- **Real app, annotated:** library tab with folders, Give-to-client dialog, the WeekAccessPanel schedule
  line and week states (admin is light-only), and the client workouts page showing week 1 and "Week 2
  unlocks on …" (light and dark if the client area supports both). Saved to
  `screenshots/program-library/`.

## Rollout

1. Push the migration on its own and wait for the production migration workflow. The migration is
   additive and the trigger does nothing on rows with a null base, so it is safe under the old code.
2. Push the code.
3. Run `test:integration:selects` before merging to `main`.
