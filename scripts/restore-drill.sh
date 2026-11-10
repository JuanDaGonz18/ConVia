#!/usr/bin/env bash
# Restore drill (docs/OPERACION.md §4): decrypts a backups/<date>.tar.gpg, restores it
# into a throwaway local Supabase stack and compares row counts per table with the dump.
#
#   bash scripts/restore-drill.sh                      # latest backups/*.tar.gpg
#   bash scripts/restore-drill.sh backups/2026-11-05.tar.gpg
#
# Never touches production: it uses no --remote flag and no project URL, only a scratch
# stack (project_id convia-restore-drill, ports 5562x) in a temporary folder outside the
# repository. The decrypted files and the stack are deleted on exit, whatever happens.
# A production dump can carry pg_cron jobs and the Vault secrets they use to call the
# hosted Edge Functions (convia_project_url, convia_cron_secret); they are deleted in the
# same transaction that loads the data, so the scratch database never calls production.
# Needs Docker running and gpg. The passphrase is asked on the terminal (not echoed);
# CONVIA_BACKUP_PASSPHRASE is read instead when set (for unattended runs).
# Exit code 0 only when every table has the row count the dump says it should.
set -euo pipefail
export LC_ALL=C  # sort and join must agree

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP="${1:-$(ls -1 "$ROOT"/backups/*.tar.gpg 2>/dev/null | sort | tail -n 1)}"
[ -n "$BACKUP" ] && [ -f "$BACKUP" ] || { echo "No backup found (backups/<date>.tar.gpg)." >&2; exit 2; }
command -v gpg >/dev/null || { echo "gpg is required." >&2; exit 2; }
docker info >/dev/null 2>&1 || { echo "Docker is not running." >&2; exit 2; }

PROJECT=convia-restore-drill
CONTAINER="supabase_db_$PROJECT"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/convia-restore.XXXXXX")"
case "$WORK" in "$ROOT"*) echo "Temporary folder is inside the repository; aborting." >&2; exit 2 ;; esac
# SUPABASE_CLI lets CI use another binary; by default the repo's devDependency.
sb() { (cd "$ROOT" && ${SUPABASE_CLI:-npx supabase} --workdir "$WORK/stack" "$@"); }

cleanup() {
  sb stop --no-backup >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "Backup: $(basename "$BACKUP")"

# 1. Decrypt and unpack outside the repository.
if [ -z "${CONVIA_BACKUP_PASSPHRASE:-}" ]; then
  read -rsp "Backup passphrase: " CONVIA_BACKUP_PASSPHRASE </dev/tty; echo
fi
mkdir -p "$WORK/backup"
printf '%s' "$CONVIA_BACKUP_PASSPHRASE" \
  | gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 0 -d "$BACKUP" \
  | tar -xf - -C "$WORK/backup"
unset CONVIA_BACKUP_PASSPHRASE
DUMP="$(dirname "$(find "$WORK/backup" -name schema.sql | head -n 1)")"
for f in roles.sql schema.sql data.sql; do
  [ -f "$DUMP/$f" ] || { echo "The backup has no $f." >&2; exit 1; }
done

# 2. Scratch stack: database, auth and storage only (they create the auth/storage schemas
#    the dump's data belongs to). No migrations: the schema comes from the backup.
mkdir -p "$WORK/stack/supabase"
cat > "$WORK/stack/supabase/config.toml" <<EOF
project_id = "$PROJECT"
[api]
port = 55621
[db]
port = 55622
shadow_port = 55620
major_version = 17
[db.pooler]
enabled = false
[db.seed]
enabled = false
[studio]
enabled = false
[local_smtp]
enabled = false
[analytics]
enabled = false
[realtime]
enabled = false
[edge_runtime]
enabled = false
EOF
sb start -x realtime,imgproxy,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor >"$WORK/start.log" 2>&1 || { cat "$WORK/start.log" >&2; exit 1; }

# 3. Restore, as Supabase's restore guide does: roles, schema, then data with triggers off.
# supabase_admin: the load also writes auth.*, storage.*, cron.* and vault.*.
psql() { docker exec -i "$CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
# Piped through stdin (no docker cp), so host paths never reach the container.
NEUTRALIZE="do \$\$ begin
  if to_regclass('cron.job') is not null then delete from cron.job; end if;
  if to_regclass('vault.secrets') is not null then delete from vault.secrets; end if;
end \$\$;"
{ cat "$DUMP/roles.sql" "$DUMP/schema.sql"; echo 'SET session_replication_role = replica;'; cat "$DUMP/data.sql"; echo "$NEUTRALIZE"; }   | psql --single-transaction >"$WORK/restore.log" 2>&1   || { echo "Restore FAILED:" >&2; grep -m 5 -i error "$WORK/restore.log" >&2; exit 1; }

# 4. Expected rows per table = the lines of each COPY block in data.sql.
awk '
  /^COPY / { table = $2; n = 0; inside = 1; next }
  inside && /^\\\.$/ { print table "\t" n; inside = 0; next }
  inside { n++ }
' "$DUMP/data.sql" | grep -vE '^"?(cron|vault)"?\.' | sort >"$WORK/expected.tsv"
[ -s "$WORK/expected.tsv" ] || { echo "data.sql has no COPY blocks (was it dumped with --use-copy?)." >&2; exit 1; }

# 5. Actual rows, one count per table.
: >"$WORK/actual.tsv"
while IFS=$'\t' read -r table _; do
  printf '%s\t%s\n' "$table" "$(psql -At -c "select count(*) from $table")" >>"$WORK/actual.tsv"
done <"$WORK/expected.tsv"

printf '\n%-55s %9s %9s\n' "table" "dump" "restored"
join -t $'\t' "$WORK/expected.tsv" "$WORK/actual.tsv" | awk -F'\t' '
  { mark = ($2 == $3) ? "" : "  <-- MISMATCH"; if ($2 != $3) bad++
    printf "%-55s %9d %9d%s\n", $1, $2, $3, mark; rows += $3; tables++ }
  END { printf "\n%d tables, %d rows, %s\n", tables, rows, bad ? bad " MISMATCH(ES)" : "all counts match"
        exit bad ? 1 : 0 }'
echo "(cron.* and vault.* are emptied on purpose and not compared.)"
echo "Result: OK ($(date +%F), $(basename "$BACKUP"))"
