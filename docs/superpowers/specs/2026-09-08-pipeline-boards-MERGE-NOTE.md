# Pipeline boards — what this branch does NOT do

**Read this before merging `feat/pipeline-boards`, and again before telling anyone the feature
is finished.** Every limitation here was found by the whole-branch review, weighed, and left in
deliberately by the owner on 2026-09-08. None of them is a surprise or an oversight; all of them
are things a reasonable person would otherwise assume were true.

## 1. The two new boards have no reader. Their cards are invisible in the product.

`app/(admin)/admin/pipeline/page.tsx` calls `readBoard(undefined, …)`, which resolves to the
default board, and the page copy says "coaching pipeline". **There is no board selector.**

So from the moment this merges, a paid camp registration and an assessment enquiry create real,
correct cards on Camps & Clinics and Assessment — and nobody can see them without querying the
database. Nothing regressed: nothing that used to be visible has moved. But the branch's headline
claim, that a camp registration and a coaching enquiry are no longer the same card, is true in
the data and unobservable in the app.

**Owner's decision:** merge anyway, picker as a follow-up. Cards accumulate correctly in the
meantime and become visible the day the picker lands.

**What the follow-up needs:** a board selector on `/admin/pipeline` (read-only — no create,
rename or reorder), and the page copy fixed. The original design's §4.5 called this "the board
screen picks a board". It is much smaller than the board EDITOR, which remains unbuilt and has
its own runtime traps.

## 2. A payment does not close the enquiry it came from

An assessment enquirer who later pays gets a **second** card — Won, on Coaching — while their
Assessment card stays open forever.

Why: no call site passes `serviceType` for a `payment` event; the Stripe webhook passes only
`checkoutType`. So `routeToPipeline`'s "however it arrives" clause for `serviceType` is
production-unreachable on the payment path. There is no duplicate-key violation, because
`opportunities_one_open_per_contact_pipeline` is scoped `(contact_id, pipeline_id)` — cross-board
cards are legal by design.

**Consequence to expect:** the Assessment board will accumulate open cards that were in fact won
elsewhere. Do not read its open count as "people who have not bought".

## 3. A coaching refund can amend a camp card

`resolveWonPipelineKey` takes the contact's most recent Won card **across all boards**, ordered
by `closed_at` with no tiebreaker. A contact with a Won coaching deal plus a newer Won camp card
gets their coaching refund applied to the camp card; the coaching board keeps the full value.

This was disclosed as a carried limitation from the original spec's §14 — but §14 accepted two
Won deals on ONE board, not misapplication ACROSS boards. It became reachable only when camp
signups started owning cards, which is this branch.

## 4. Camp and clinic ENQUIRIES still route to Coaching

`lib/validators/inquiry.ts` accepts `service: "camp"` and `"clinic"`, and both route to Coaching,
while a camp PAYMENT routes to Camps & Clinics. This matches the spec as written (§3.2 names only
`assessment`), but it half-delivers the branch's own headline: the enquiry and the payment for the
same camp land on different boards.

## 5. New tenants do not get the new boards

`create_business()` (migration `00249`) seeds only `coaching`. Migration `00257` seeded the two
new boards for businesses that existed when it ran. **Production has exactly one business, so it
is fully covered today.** Every future tenant gets Coaching only, and routing to a board they lack
falls back to Coaching rather than throwing — verified, with tests and a presence control.

## What IS solid, so this reads fairly

Routing itself, the refund resolution, the tenant fallback, and both migrations were reviewed
end to end and independently re-verified: 288 branch tests green, `tsc` at the exact 238/54
baseline with a byte-identical per-file set, `npm run build` exit 0, the `MoveTrigger` union
pinned to its SQL CHECK by an exact-equality test, and an exhaustiveness arm on `decideMove` that
was proved to bite by adding a fake union member and watching the compiler reject it.
