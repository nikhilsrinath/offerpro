# Runbook — backup and restore

> **Status: written, NOT yet rehearsed.** FIX_PLAN item 9 requires one real
> restore into a scratch project with the elapsed time recorded before this
> document can be trusted. Until the "Rehearsal log" at the bottom has an entry,
> treat every duration here as an estimate and the procedure as unproven. A
> runbook nobody has executed is a hypothesis.

**Targets:** RPO 24 hours · RTO 4 hours.

Meaning: at worst we lose the last 24 hours of writes (1 minute with PITR on,
which is why PITR is the first task below), and a total loss is back in service
within 4 hours of the decision to restore.

---

## 1. What has to be turned on (do this first — it is not in code)

Supabase exposes backups as project settings, not as SQL, so these cannot live in
a migration. They are the one part of this runbook that has to be clicked, and
until they are done **there is nothing to restore from.**

| # | Setting | Where | Value |
|---|---|---|---|
| 1 | **Point-in-Time Recovery** | Dashboard → Database → Backups → PITR | On, 7-day window (Pro plan or above) |
| 2 | **Daily physical backups** | same page | On by default on Pro; confirm the most recent one is less than 24h old |
| 3 | **Storage backups** | Dashboard → Storage | Supabase does **not** include Storage objects in PITR. Schedule the object sync in §4 |
| 4 | **Off-platform copy** | §4 | A backup inside the only account that can be lost is not a backup |

Record the date each was enabled in the log at the bottom.

### Why an off-platform copy

Every control above protects against *our* mistake — a bad migration, a dropped
table, a delete nobody meant. None of them protects against losing the Supabase
account itself: a billing failure, a suspension, a compromised owner login. The
weekly dump in §4 is the only copy that survives that, and it is the reason the
schedule exists at all.

---

## 2. Restore decision tree

Work top to bottom. Stop at the first row that matches — the cheapest remedy that
fixes the problem is the right one, and each row below is substantially more
disruptive than the one above it.

| Symptom | Remedy | Downtime |
|---|---|---|
| One tenant's rows wrong, app otherwise fine | §3.1 single-tenant restore from their export or a branch | none |
| One table mangled by a known bad migration | §3.2 restore that table from a PITR branch | none for other tables |
| Wrong data committed org-wide, time known | §3.3 PITR to the timestamp before it | full, ~30-60 min |
| Project gone / unrecoverable | §3.4 rebuild from migrations + latest dump | full, up to 4h |
| Uploaded files missing, database fine | §3.5 storage restore | feature-level |

---

## 3. Procedures

### 3.1 One tenant, no downtime

Preferred whenever the blast radius is a single `org_id`. Nobody else is
interrupted.

1. Get the data: the customer's own download (`/api/export?org_id=…`, Profile →
   Account Settings → Export all my data) if they have a recent one, otherwise
   create a PITR branch (§3.2 step 1) and read the rows out of it.
2. Restore into the live project inside a transaction, one table at a time, in
   foreign-key order: `clients` → `employees` → `records` /
   `financial_documents` → `document_line_items` → `payments`.
3. `supabase/tests/01_isolation_test.sql` afterwards, to prove the restore did
   not land rows under the wrong tenant.

**Soft-deleted org** (the `/api/admin` delete, which sets `deleted_at` and hides
the tenant from every client query):

```sql
update organizations set deleted_at = null, deleted_by = null where id = '<org_id>';
```

That is the whole restore — no data was removed. This is why the admin panel does
a soft delete.

### 3.2 One table, from a branch

1. Dashboard → Database → Backups → PITR → **Restore to a new branch** at a
   timestamp before the damage. Never restore in place for a single table; a
   branch leaves production untouched while you look.
2. Connect to the branch and copy the table across with `pg_dump`/`psql`:

```bash
pg_dump "$BRANCH_URL" --data-only --table=public.<table> > table.sql
psql "$PROD_URL" -v ON_ERROR_STOP=1 -c 'begin;' -f table.sql -c 'commit;'
```

3. If the table has dependents, restore children in the same transaction or the
   foreign keys will refuse the insert.
4. Drop the branch when done — it bills separately.

### 3.3 Whole project, to a point in time

**This discards every write after the chosen timestamp.** Announce it before
starting; the window is usually known from the audit log (§5).

1. Put the app in maintenance: Vercel → Deployments → promote a holding page, or
   pause the deployment. Writes during a restore are lost and confusing.
2. Find the timestamp: `select * from audit_log where org_id = '…' order by
   created_at desc limit 50;` — that is what 0020's trigger is for. Choose one
   minute **before** the first bad row.
3. Dashboard → Database → Backups → PITR → restore the project to that
   timestamp. Expect 10-40 minutes depending on size.
4. After it comes back, in this order:
   - `select max(version) from supabase_migrations.schema_migrations;` — confirm
     the schema is the one the deployed app expects. A restore to before a
     migration brings the old schema back with it.
   - Re-apply any migration newer than that: `supabase db push`.
   - `psql -f supabase/tests/01_isolation_test.sql` — RLS must still hold.
   - Smoke test: sign in, open Customers, open an invoice, download a PDF, open a
     portal link.
5. Un-pause the deployment. Note the elapsed time in the log.

### 3.4 Rebuild from nothing

For a lost or suspended project. This is the path the off-platform dump exists
for.

1. Create a new Supabase project. Record the new ref, URL, anon key, service key.
2. Schema, from this repository — the migrations are the source of truth:
   `supabase link --project-ref <new-ref> && supabase db push`
3. Data, from the most recent weekly dump (§4):
   `psql "$NEW_URL" -v ON_ERROR_STOP=1 -f edgeos-YYYY-MM-DD.sql`
4. Storage objects, from the object sync (§4) — `supabase storage cp --recursive`
   per bucket, or the `rclone` command in that section reversed.
5. **Auth users do not come back with the data.** `auth.users` lives in a schema
   the dump does not include, and password hashes are not exportable. Either
   restore from a physical backup (which does include `auth`), or send every user
   a password reset — `memberships.user_id` is a foreign key to `auth.users`, so
   the ids must match or every membership breaks. This is the step that turns a
   4-hour RTO into a longer one; prefer the physical backup.
6. Update the environment in Vercel (all of `.env.example`), redeploy, then the
   §3.3 step 4 verification list.

### 3.5 Storage only

```bash
# objects for one org, from the off-platform copy back into the bucket
rclone copy remote:edgeos-backup/storage/org-branding/<org_id> \
           supabase:org-branding/<org_id>
```

Then check one document renders: a logo, a signature and a stamp all come from
separate buckets, and `signature_url` is a signed URL regenerated on read, so a
stale URL in a `company_snapshot` is expected and harmless.

---

## 4. The off-platform copy (scheduled, outside this repo)

Nothing in this project runs on a schedule — there is no cron, no queue, no
worker (`feature-audit.md` #29). So this is a GitHub Actions workflow or an
external scheduler, and it is **not yet created**:

```yaml
# .github/workflows/backup.yml — TO BE CREATED
# Weekly: pg_dump to object storage outside the Supabase account.
#   pg_dump "$SUPABASE_DB_URL" --no-owner --no-acl -Fc > edgeos-$(date +%F).dump
#   rclone copy edgeos-*.dump remote:edgeos-backup/db/
#   supabase storage cp --recursive ss:///org-branding ./storage/org-branding
#   rclone copy ./storage remote:edgeos-backup/storage/
# Retention: 12 weekly, 12 monthly.
```

Retention to match FIX_PLAN item 9: 30 days of dailies (Supabase's own), weeklies
kept 12 months.

---

## 5. What helps you find the damage

- **`audit_log`** — since `0020_audit_triggers.sql`, every insert, update and
  delete on the nine tables that matter, with the actor and a column-level diff.
  This is the first place to look, and it is how you pick the timestamp in §3.3.
- **`document_signatures`** — legally significant events, append-only.
- **Soft deletes** — `organizations.deleted_at`. No tenant is ever hard-deleted
  by the application.
- **`supabase_migrations.schema_migrations`** — which migrations this database has
  actually seen.

---

## 6. Rehearsal log

Item 9 is not complete until this table has a row. Add one after each drill; a
restore path that has not been walked in a year has not been tested.

| Date | Procedure | Operator | Elapsed | Outcome / what needed fixing |
|---|---|---|---|---|
| _(none yet)_ | | | | |

Also record here when each setting in §1 was switched on.
