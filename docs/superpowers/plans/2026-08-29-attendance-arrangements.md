# Attendance arrangements — clients the facility bills, that I still coach

**Date:** 2026-08-29
**Branch:** `feat/attendance-arrangements` (off `main` @ cbef97f3)

## The problem

The coach works with clients in person at a tennis facility. Those clients use the
app (programs, workouts, progress) and he coaches them — but they buy **no package
through the app**, because the facility bills them through the facility's own
system. He still needs the attendance record on his side, so he has his own number
to check against the facility's.

Today that is impossible. Every check-in is bolted to a paid pack:

- `session_checkins.client_package_id` is `NOT NULL` (00170).
- `checkInClient` finds the oldest active pack, deducts a credit, or returns
  `no_credits` → 409. All three doors (QR roster, personal link, coach tap) go
  through it.
- The QR roster is built from `client_packages WHERE status='active'`, so a client
  with no pack never appears on it.

The nearest workaround — a $0 **Complimentary** pack — actually works today and
stays out of the books (the income adapter skips anything not `payment_status:
'paid'`). But it is **metered**: you pick a credit count, it runs down to zero, and
it locks them out at the door mid-term. Metering is the wrong shape for an
arrangement that has no credits in the first place.

## The decision

An attendance arrangement is **not a package**, so it does not live in
`client_packages`. Widening that table would ripple into the renewal cron, the
bookkeeping income adapter, Stripe, auto-renew and the client-facing card panel —
all of which exist to move money that this arrangement never involves.

Instead: a small `attendance_arrangements` table, and one nullable column on the
existing ledger so **attendance and credit check-ins share one history**. The
client's training record stays complete, and the monthly count is one query.

### Rulings

1. **Coach tap only.** `checkInClient` gains `allowUnmetered`, default **false**;
   only the admin coach-tap route passes `true`. Rationale: this ledger is the
   coach's evidence of work done at someone else's facility. Self-serve check-in
   is right when a client is spending credits they paid for — they are motivated
   to tap. A facility client has no stake in tapping, and every missed tap
   silently undercounts the coach's own pay. Flipping this on later is one flag.
2. **No facility entity.** One facility exists. An arrangement carries a free-text
   `label`; a `facilities` table is speculative until there is a second one.
3. **A monthly total is in scope**, because it is the unstated real need —
   an attendance log you cannot total per month does not let you check their
   number against yours.
4. **At most one active arrangement per client** (partial unique index). A pack,
   if the client ever buys one, takes precedence — paid credits burn first.

## Shape

```
attendance_arrangements
  client_user_id → users, label, session_type, status(active|ended),
  started_on, ended_on, notes, created_by

session_checkins
  client_package_id  → NULLABLE          (was NOT NULL)
  arrangement_id     → NEW, nullable FK
  CHECK num_nonnulls(client_package_id, arrangement_id) = 1
```

An attendance check-in is a normal ledger row with `credit_delta = 0` and no pack.

## Deploy order

Migration **must land before** the code. Widening `client_package_id` to nullable
is backward-compatible (old code always writes a non-null value); new code writing
`arrangement_id` fails against the old schema. The CHECK passes on all existing
rows (`client_package_id` non-null, `arrangement_id` null → exactly 1).

## Tasks

1. Migration `00234_attendance_arrangements.sql`
2. Types: `AttendanceArrangement`, `SessionCheckin.client_package_id` nullable + `arrangement_id`
3. DAL `lib/db/attendance-arrangements.ts`; arrangement reads on the checkins DAL
4. `checkInClient` unmetered fallback + `voidCheckinAndRestore` null-pack guard
5. Admin routes: start / end an arrangement
6. Coach-tap route: pass `allowUnmetered`, audit the attendance case
7. UI: `AttendanceArrangementPanel` in Sessions & Billing; `ClientCheckinButton`
   renders for an arrangement
8. `/admin/attendance` monthly roll-up + nav registration
9. Tests + build; apply migration to dev
