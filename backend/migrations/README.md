<!--
Fresh DBs: apply backend/schema.sql, then migrations (0002 re-adds photo_permission_* columns already in schema.sql, so its duplicate-column errors are expected and safe to skip; 0003/0004 are idempotent).
Existing prod DBs: apply migrations only, never schema.sql (it drops tables).
-->

# Migrations

- Fresh DBs: apply `schema.sql`, then the migrations.
- Existing prod DBs: apply migrations only.
