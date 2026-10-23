#!/usr/bin/env bash
# Runs all migrations and the tenant-isolation tests on a LOCAL throwaway Postgres (16+).
# Never point this at Supabase. Usage: PGUSER=postgres ./run_local.sh   (needs psql and a running local server)
set -euo pipefail
DB=${DB:-codex_core_test}
cd "$(dirname "$0")/.."
q() { psql -v ON_ERROR_STOP=1 -q -X "$@"; }
q -d postgres -c "drop database if exists $DB" -c "create database $DB"
for f in tests/stub_supabase.sql migrations/20261020000001_waitlist.sql migrations/20261020000002_admin.sql migrations/20261021000003_core.sql migrations/20261021000004_waitlist_throttle.sql migrations/20261021000005_monitor.sql; do
  q -d "$DB" -f "$f" >/dev/null
done
for f in migrations/20261021000003_core.sql migrations/20261021000004_waitlist_throttle.sql migrations/20261021000005_monitor.sql; do q -d "$DB" -f "$f" >/dev/null; done   # re-applying must not fail
echo "migrations applied (core migration twice)"
out=$(q -d "$DB" -f tests/core_isolation_test.sql; q -d "$DB" -f tests/waitlist_throttle_test.sql; q -d "$DB" -f tests/monitor_test.sql)
echo "$out"
failed=$(psql -X -At -d "$DB" -c "select count(*) from t.results where not ok")
total=$(psql -X -At -d "$DB" -c "select count(*) from t.results")
[ "$failed" = "0" ] && [ "$total" -gt 0 ] && echo "ALL $total CHECKS PASSED" || { echo "$failed of $total CHECKS FAILED"; exit 1; }
