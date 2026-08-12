#!/usr/bin/env bash
#
# Applies any migration in supabase/migrations/ that public.repo_migrations has
# not recorded, in filename order.
#
# THE ONE PROPERTY THAT MATTERS: the migration and the ledger row are written in
# the SAME TRANSACTION. If the job is killed between them — a cancelled run, a
# runner going away — there is no state where a migration has been applied but
# not recorded, which is the state that makes the next run re-apply it.
#
# Every file here is transaction-safe: checked 2026-08-13, no migration uses
# CREATE INDEX CONCURRENTLY or its own BEGIN/COMMIT. A future migration that
# needs CONCURRENTLY cannot be applied by this script and must be run by hand —
# psql --single-transaction would fail it.
#
# STOPS AT THE FIRST FAILURE. Continuing past a failed migration would apply
# later ones against a schema their author never anticipated.

set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"

MIGRATIONS_DIR="${MIGRATIONS_DIR:-supabase/migrations}"
DRY_RUN="${DRY_RUN:-false}"

# `--no-psqlrc` so a runner's stray config cannot change behaviour;
# ON_ERROR_STOP so psql exits non-zero on the first bad statement rather than
# ploughing on and reporting success.
PSQL=(psql "$SUPABASE_DB_URL" --no-psqlrc -v ON_ERROR_STOP=1)

if ! "${PSQL[@]}" -Atc "SELECT to_regclass('public.repo_migrations')" | grep -q "repo_migrations"; then
  echo "::error::public.repo_migrations does not exist. Run scripts/migrations/baseline.sql against this database first."
  echo "Refusing to continue: without the baseline every migration looks unapplied."
  exit 1
fi

applied_list="$(mktemp)"
"${PSQL[@]}" -Atc "SELECT filename FROM public.repo_migrations" | sort > "$applied_list"

pending=()
while IFS= read -r path; do
  name="$(basename "$path")"
  if ! grep -Fxq "$name" "$applied_list"; then
    pending+=("$name")
  fi
done < <(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' | sort)

if [ ${#pending[@]} -eq 0 ]; then
  echo "No pending migrations. $(wc -l < "$applied_list") already applied."
  exit 0
fi

echo "Pending migrations (${#pending[@]}):"
printf '  %s\n' "${pending[@]}"

if [ "$DRY_RUN" = "true" ]; then
  echo "DRY_RUN=true — nothing was applied."
  exit 0
fi

for name in "${pending[@]}"; do
  echo "--- applying $name"
  combined="$(mktemp)"
  cat "$MIGRATIONS_DIR/$name" > "$combined"
  # The ledger row rides in the same transaction as the DDL above it.
  printf "\nINSERT INTO public.repo_migrations (filename) VALUES (%s);\n" \
    "$(printf "'%s'" "${name//\'/\'\'}")" >> "$combined"

  "${PSQL[@]}" --single-transaction -f "$combined"
  rm -f "$combined"
  echo "--- applied  $name"
done

echo "Applied ${#pending[@]} migration(s)."
