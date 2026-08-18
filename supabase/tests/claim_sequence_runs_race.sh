#!/usr/bin/env bash
# supabase/tests/claim_sequence_runs_race.sh
#
# NOTE: requires bash >= 4.4 (arrays under `set -u` behave differently on the
# ancient bash 3.2 macOS ships as /bin/bash — this shebang deliberately uses
# `env bash` to pick up a modern bash, e.g. from Homebrew, ahead of it on
# PATH).
#
# Proves the ONE concurrency property `public.claim_sequence_runs`
# (supabase/migrations/00217_lead_engine_sequence_functions.sql) exists for:
# two overlapping 5-minute ticks must not claim the same sequence_runs row,
# because a claimed row is the thing that gets emailed to a real person.
#
# WHY THIS IS A SHELL SCRIPT DRIVING TWO REAL psql PROCESSES, NOT A SQL
# SCRIPT OR A VITEST TEST: `FOR UPDATE SKIP LOCKED` is a property of two
# transactions overlapping in time. A single psql session runs one
# transaction at a time and cannot demonstrate it. A vitest mock that
# returns disjoint sets only proves the mock was written to. A test
# asserting the migration text contains the words "SKIP LOCKED" is worth
# nothing. The only honest proof is two concurrent database sessions, one
# holding its claim's row locks open while the other calls the same
# function and is observed to skip them instead of blocking or double-claiming.
#
# THREE ASSERTIONS, each in its own dedicated business_id so they cannot
# interfere with one another (claim_sequence_runs filters by business_id,
# so nothing seeded for one assertion is ever visible to another):
#
#   1. Two concurrent claims (session A holds an open transaction on its
#      claimed rows; session B calls concurrently with a bounded
#      lock_timeout) return DISJOINT run sets, B does not block, and the
#      union is no larger than the pool of due runs.
#   2. A run claimed less than 10 minutes ago is NOT re-claimed.
#   3. A run whose claim is older than 10 minutes IS re-claimed (the arm
#      that stops a crashed tick from stranding its runs forever).
#
# HOW TO RUN (against the local throwaway Postgres 18.4 cluster):
#   export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"
#   <pgcheck.sh helper> 00212 00213 00214 00215 00216 00217 00218   # fresh schema
#   supabase/tests/claim_sequence_runs_race.sh
#
# Connection defaults to 127.0.0.1:55433 / postgres / mcheck (the scratch
# cluster documented in CONTEXT.md). Override PGHOST/PGPORT/PGUSER/
# PGDATABASE/PGPASSWORD before invoking to point this at a different
# Postgres — see the IMPORTANT note at the bottom of this header.
#
# Every seeded row lives under one of three throwaway `businesses` rows
# created at the top of this run and DELETEd (which CASCADEs to every
# child: contacts, sequences, sequence_steps, sequence_runs) in a trap that
# fires on any exit path, success or failure. Re-run any number of times;
# it leaves no residue. This mirrors the "no residue" goal of
# merge_contacts_scenarios.sql, by DELETE-under-trap rather than
# BEGIN/ROLLBACK, because assertion 1 needs its seed data to survive across
# two independent, real, concurrent transactions — a single wrapping
# transaction cannot do that.
#
# Assertions 2 and 3 are plpgsql DO blocks that RAISE EXCEPTION on failure,
# in the same style as merge_contacts_scenarios.sql. Assertion 1 is
# evaluated in bash because it is the one property that genuinely requires
# two OS processes.
#
# EXIT CODE: 0 iff all three assertions passed. Non-zero (count of failed
# assertions) otherwise. Prints a PASS/FAIL line for every assertion.
#
# IMPORTANT — PROVED LOCALLY ONLY: this proves the property against a local
# throwaway Postgres 18.4 cluster, not against Supabase. Migrations
# 00212-00218 have never been applied to any real Supabase project
# (including the .env.local clone), so this script cannot run there yet.
# Before this feature launches, re-point PGHOST/PGPORT/PGUSER/PGDATABASE/
# PGPASSWORD at a real Supabase Postgres connection with the same
# migrations applied and re-run this script against it.

set -uo pipefail

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-55433}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-mcheck}"
export PGHOST PGPORT PGUSER PGDATABASE

FAILURES=0
WORKDIR="$(mktemp -d)"
CLEANUP_IDS=()

cleanup() {
  for id in "${CLEANUP_IDS[@]:-}"; do
    [ -n "$id" ] && psql -tAc "DELETE FROM public.businesses WHERE id = '$id'" >/dev/null 2>&1
  done
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

fresh_business() {
  # $1 = human-readable name suffix
  psql -tAc "WITH ins AS (INSERT INTO public.businesses (name) VALUES ('claim_sequence_runs_race: $1') RETURNING id) SELECT id FROM ins"
}

echo "== claim_sequence_runs concurrency race =="
echo "target: $PGUSER@$PGHOST:$PGPORT/$PGDATABASE"
echo

# -----------------------------------------------------------------------
# Preflight: the function and its table must exist, or every assertion
# below is a false pass on an empty query. Fail loudly rather than skip
# silently — this script is only ever run by hand against a database that
# is supposed to have the schema (see the header note on where it's safe
# to run this).
# -----------------------------------------------------------------------
if ! psql -tAc "SELECT 1 FROM pg_proc WHERE proname = 'claim_sequence_runs'" | grep -q 1; then
  echo "FATAL: public.claim_sequence_runs does not exist in $PGDATABASE. Apply migrations 00212-00218 first." >&2
  exit 2
fi

# =========================================================================
# ASSERTION 1 — two concurrent claims return disjoint sets, and B does not
# block.
# =========================================================================

BIZ_POOL="$(fresh_business "assertion 1 pool")"
CLEANUP_IDS+=("$BIZ_POOL")

POOL_SIZE=20
A_LIMIT=12   # deliberately smaller than the pool so a split is *likely*
B_LIMIT=20   # observable (A takes up to 12, B up to the remaining 8) — but
             # NOT guaranteed: see the "only three properties" note below.
             # A=$POOL_SIZE/B=0 is a valid outcome and must still PASS.

psql -v biz="$BIZ_POOL" -v ON_ERROR_STOP=1 -q <<SQL
INSERT INTO public.sequences (business_id, key, name, status)
VALUES (:'biz'::uuid, 'race_pool_sequence', 'Race Pool Sequence', 'draft');
WITH pool_contacts AS (
  INSERT INTO public.contacts (business_id, email)
  SELECT :'biz'::uuid, 'race-pool-' || g || '@example.invalid'
  FROM generate_series(1, $POOL_SIZE) AS g
  RETURNING id
)
INSERT INTO public.sequence_runs (business_id, sequence_id, contact_id, status, next_run_at)
SELECT :'biz'::uuid,
       (SELECT id FROM public.sequences WHERE business_id = :'biz'::uuid AND key = 'race_pool_sequence'),
       id, 'active', now() - interval '1 minute'
FROM pool_contacts;
SQL
if [ $? -ne 0 ]; then
  echo "FATAL: assertion 1 seed step failed" >&2
  exit 2
fi

MARKER="$WORKDIR/a_claimed.marker"
OUT_A="$WORKDIR/out_a.txt"
OUT_B="$WORKDIR/out_b.txt"
rm -f "$MARKER"

cat > "$WORKDIR/session_a.sql" <<SQL
BEGIN;
\echo ===RESULT_A_START===
SELECT coalesce(string_agg(id::text, ','), '')
  FROM public.claim_sequence_runs('$BIZ_POOL'::uuid, $A_LIMIT, 'tick-a');
\echo ===RESULT_A_END===
\! touch '$MARKER'
-- Hold the transaction (and its row locks from the UPDATE above) open
-- while session B runs concurrently against the same due rows.
SELECT pg_sleep(4);
COMMIT;
SQL

psql -t -A -X -f "$WORKDIR/session_a.sql" >"$OUT_A" 2>&1 &
PID_A=$!

# Bounded poll for the handshake marker rather than a blind sleep: session A
# writes it right after its claim (and thus its row locks) are in place, so
# session B is guaranteed to start only once there is something to skip.
i=0
until [ -f "$MARKER" ]; do
  i=$((i + 1))
  if [ "$i" -gt 200 ]; then
    echo "FATAL: timed out waiting for session A to claim its rows" >&2
    kill "$PID_A" 2>/dev/null
    exit 2
  fi
  sleep 0.05
done

cat > "$WORKDIR/session_b.sql" <<SQL
-- A plain FOR UPDATE (no SKIP LOCKED) would block here until session A
-- commits or rolls back. Bound the wait so a block is a fast, detectable
-- failure instead of a hang.
SET lock_timeout = '2s';
\echo ===RESULT_B_START===
SELECT coalesce(string_agg(id::text, ','), '')
  FROM public.claim_sequence_runs('$BIZ_POOL'::uuid, $B_LIMIT, 'tick-b');
\echo ===RESULT_B_END===
SQL

psql -t -A -X -f "$WORKDIR/session_b.sql" >"$OUT_B" 2>&1
B_EXIT=$?

wait "$PID_A"
A_EXIT=$?

ids_a="$(sed -n '/===RESULT_A_START===/,/===RESULT_A_END===/p' "$OUT_A" | sed '1d;$d')"
ids_b="$(sed -n '/===RESULT_B_START===/,/===RESULT_B_END===/p' "$OUT_B" | sed '1d;$d')"

assert1_failed=0
if [ "$A_EXIT" -ne 0 ]; then
  echo "ASSERTION 1 FAILED: session A errored (exit $A_EXIT) — see below"
  cat "$OUT_A"
  assert1_failed=1
elif grep -qiE "lock timeout|canceling statement|deadlock detected|could not obtain lock" "$OUT_B"; then
  echo "ASSERTION 1 FAILED: session B blocked waiting on session A's row locks (SKIP LOCKED is missing or a plain FOR UPDATE is blocking)."
  echo "session B output:"
  cat "$OUT_B"
  assert1_failed=1
elif [ "$B_EXIT" -ne 0 ]; then
  echo "ASSERTION 1 FAILED: session B errored (exit $B_EXIT) — see below"
  cat "$OUT_B"
  assert1_failed=1
else
  IFS=',' read -r -a ARR_A <<<"$ids_a"
  IFS=',' read -r -a ARR_B <<<"$ids_b"
  # Empty strings split into a one-element array holding "" — drop that.
  [ "$ids_a" = "" ] && ARR_A=()
  [ "$ids_b" = "" ] && ARR_B=()
  count_a=${#ARR_A[@]}
  count_b=${#ARR_B[@]}

  overlap=0
  for id in "${ARR_A[@]}"; do
    for other in "${ARR_B[@]}"; do
      if [ "$id" = "$other" ]; then
        overlap=$((overlap + 1))
      fi
    done
  done

  union=$((count_a + count_b))
  echo "session A (tick-a, limit $A_LIMIT) claimed $count_a run(s)"
  echo "session B (tick-b, limit $B_LIMIT) claimed $count_b run(s)"

  # Only three properties are actually guaranteed by a correct
  # implementation, and only these are asserted:
  #   1. disjoint      — no run id appears in both sets (the double-send guard)
  #   2. B did not block — checked above, before this branch is even reached
  #   3. union <= pool  — nothing was claimed twice or conjured
  #
  # A particular SPLIT (e.g. "both sessions got a nonzero share") is
  # deliberately NOT asserted. A=$POOL_SIZE, B=0 is a legitimate SKIP LOCKED
  # outcome: it means session A's own claim (limit $A_LIMIT) reached
  # everything eligible before session B's query ran, which SKIP LOCKED
  # permits — it guarantees B never blocks and never re-claims what A
  # holds, but makes no promise about how the remainder is divided. A's
  # limit is set below the pool size so a split is *likely* observable, but
  # asserting a specific split size would fail a correct implementation
  # whenever session B's process happens to start slowly (a timing
  # artifact, not a correctness bug) — exactly the failure mode a flaky
  # test produces. `union == 0` is still asserted as a failure: with
  # $POOL_SIZE due, unclaimed runs seeded and neither session did block,
  # neither session claiming anything is not a timing artifact, it means
  # the seed step or the function's WHERE clause is broken.
  if [ "$overlap" -ne 0 ]; then
    echo "ASSERTION 1 FAILED: $overlap run id(s) were claimed by BOTH sessions — SKIP LOCKED did not prevent a double-claim."
    assert1_failed=1
  elif [ "$union" -gt "$POOL_SIZE" ]; then
    echo "ASSERTION 1 FAILED: union of claimed runs ($union) exceeds the pool of $POOL_SIZE due runs — a run was claimed more than once or conjured."
    assert1_failed=1
  elif [ "$union" -eq 0 ]; then
    echo "ASSERTION 1 FAILED: neither session claimed anything from a pool of $POOL_SIZE due, unclaimed runs — the seed step or the function's WHERE clause is broken."
    assert1_failed=1
  else
    echo "ASSERTION 1 PASSED: disjoint claims (0 overlap), union $union <= pool $POOL_SIZE, session B did not block."
  fi
fi
[ "$assert1_failed" -eq 1 ] && FAILURES=$((FAILURES + 1))
echo

# =========================================================================
# ASSERTIONS 2 and 3 — the staleness window on claimed_at.
# Each gets its OWN business_id so neither's claim call can touch the
# other's seed row.
# =========================================================================

BIZ_RECENT="$(fresh_business "assertion 2 recent-claim")"
CLEANUP_IDS+=("$BIZ_RECENT")
BIZ_STALE="$(fresh_business "assertion 3 stale-claim")"
CLEANUP_IDS+=("$BIZ_STALE")

# Seed each fixture and capture its run id directly (bash variables, not
# psql `:'var'` substitution — psql does not interpolate `:'var'` tokens
# inside a dollar-quoted `DO $$ ... $$` body below, since $$ is itself a
# string-literal boundary as far as psql's client-side parser is concerned).
psql -v biz="$BIZ_RECENT" -v ON_ERROR_STOP=1 -q <<'SQL'
INSERT INTO public.sequences (business_id, key, name, status)
VALUES (:'biz'::uuid, 'race_recent_sequence', 'Race Recent Sequence', 'draft');
WITH c AS (
  INSERT INTO public.contacts (business_id, email)
  VALUES (:'biz'::uuid, 'race-recent-claim@example.invalid')
  RETURNING id
)
INSERT INTO public.sequence_runs
  (business_id, sequence_id, contact_id, status, next_run_at, claimed_at, claimed_by)
SELECT :'biz'::uuid,
       (SELECT id FROM public.sequences WHERE business_id = :'biz'::uuid AND key = 'race_recent_sequence'),
       id, 'active', now() - interval '1 minute',
       now() - interval '5 minutes', 'seed-recent-tick'
FROM c;
SQL
if [ $? -ne 0 ]; then
  echo "FATAL: assertion 2 seed step failed" >&2
  exit 2
fi
RUN_RECENT="$(psql -tAc "SELECT id FROM public.sequence_runs WHERE business_id = '$BIZ_RECENT'")"

psql -v biz="$BIZ_STALE" -v ON_ERROR_STOP=1 -q <<'SQL'
INSERT INTO public.sequences (business_id, key, name, status)
VALUES (:'biz'::uuid, 'race_stale_sequence', 'Race Stale Sequence', 'draft');
WITH c AS (
  INSERT INTO public.contacts (business_id, email)
  VALUES (:'biz'::uuid, 'race-stale-claim@example.invalid')
  RETURNING id
)
INSERT INTO public.sequence_runs
  (business_id, sequence_id, contact_id, status, next_run_at, claimed_at, claimed_by)
SELECT :'biz'::uuid,
       (SELECT id FROM public.sequences WHERE business_id = :'biz'::uuid AND key = 'race_stale_sequence'),
       id, 'active', now() - interval '1 minute',
       now() - interval '11 minutes', 'seed-dead-tick'
FROM c;
SQL
if [ $? -ne 0 ]; then
  echo "FATAL: assertion 3 seed step failed" >&2
  exit 2
fi
RUN_STALE="$(psql -tAc "SELECT id FROM public.sequence_runs WHERE business_id = '$BIZ_STALE'")"

# Build the DO blocks with the seeded ids interpolated by bash BEFORE psql
# ever sees them, since they must land inside literal $$ ... $$ bodies.
ASSERT_23_SQL="$WORKDIR/assert_23.sql"
cat >"$ASSERT_23_SQL" <<SQL
-- Assertion 2: a run claimed less than 10 minutes ago must not be re-claimed.
DO \$\$
DECLARE
  v_claimed uuid[];
BEGIN
  SELECT array_agg(id) INTO v_claimed
    FROM public.claim_sequence_runs('$BIZ_RECENT'::uuid, 50, 'tick-assert2');

  IF '$RUN_RECENT'::uuid = ANY(v_claimed) THEN
    RAISE EXCEPTION 'ASSERTION 2 FAILED: a run claimed 5 minutes ago (inside the 10-minute reclaim window) was re-claimed by a second tick';
  END IF;

  RAISE NOTICE 'ASSERTION 2 PASSED: a run claimed 5 minutes ago was correctly left alone';
END \$\$;

-- Assertion 3: a run whose claim is older than 10 minutes must be
-- re-claimed (the arm that un-strands a crashed tick's runs).
DO \$\$
DECLARE
  v_claimed uuid[];
BEGIN
  SELECT array_agg(id) INTO v_claimed
    FROM public.claim_sequence_runs('$BIZ_STALE'::uuid, 50, 'tick-assert3');

  IF NOT ('$RUN_STALE'::uuid = ANY(v_claimed)) THEN
    RAISE EXCEPTION 'ASSERTION 3 FAILED: a run whose claim was 11 minutes old (stale) was NOT re-claimed';
  END IF;

  RAISE NOTICE 'ASSERTION 3 PASSED: a run whose claim was 11 minutes old was correctly re-claimed';
END \$\$;
SQL

ASSERT_23_OUT="$WORKDIR/assert_23_out.txt"
psql -v ON_ERROR_STOP=1 -f "$ASSERT_23_SQL" >"$ASSERT_23_OUT" 2>&1
ASSERT_23_EXIT=$?

cat "$ASSERT_23_OUT"
echo

if [ "$ASSERT_23_EXIT" -ne 0 ]; then
  n_failed=$(grep -c "ERROR:" "$ASSERT_23_OUT")
  [ "$n_failed" -lt 1 ] && n_failed=1
  FAILURES=$((FAILURES + n_failed))
fi

echo "== summary: $FAILURES assertion(s) failed =="
exit "$FAILURES"
