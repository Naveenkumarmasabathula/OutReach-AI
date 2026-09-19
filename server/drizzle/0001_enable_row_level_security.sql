-- Second, DB-level tenant-isolation layer (docs/multi-tenancy.md §2).
--
-- IMPORTANT: FORCE ROW LEVEL SECURITY has no effect on a superuser or the
-- table owner unless that owner is not a superuser — Postgres superusers
-- always bypass RLS regardless of FORCE. The docker-compose Postgres user
-- ("hospital") is the bootstrap superuser used to run migrations, so it must
-- NOT be the role the application connects as, or this entire layer would be
-- silently inert. We create a dedicated, non-superuser "app_runtime" role
-- here for the app to connect as at runtime (see server/.env's DATABASE_URL
-- vs MIGRATE_DATABASE_URL) — migrations still run as the superuser, since
-- creating tables/roles requires elevated privileges the app itself must
-- never have.
--
-- Dev-only password below, matching the existing committed dev credentials in
-- docker-compose.yml — replace with a real secret before any non-local
-- deployment (see docs/known-limitations.md).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime LOGIN PASSWORD 'app_runtime_dev_password' NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_runtime', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;

-- Applied to every table where "hospital_id" is NOT NULL and the only
-- legitimate access pattern is "within one hospital's scope" — i.e. every
-- clinical/operational table, but NOT "users": user lookup by email during
-- login is a deliberate, narrow, unscoped cross-hospital operation (see
-- src/services/userService.ts findUserByEmail), and FORCE RLS with a policy
-- keyed on a session variable would silently return zero rows for that query
-- since no hospital is known yet at that point. "users" isolation instead
-- relies on the app-layer hospital_id filter alone.
--
-- The app sets app.current_hospital_id via SET LOCAL / set_config for every
-- request that goes through withHospitalScope() (src/db/scope.ts). Because a
-- policy with no explicit WITH CHECK reuses USING for both, an INSERT/UPDATE
-- writing a hospital_id other than the current session's scope is rejected by
-- Postgres itself, not just by application code.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'patients',
    'encounters',
    'conditions',
    'medications',
    'procedures',
    'care_plans',
    'observations',
    'communications',
    'tasks'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (hospital_id = current_setting(''app.current_hospital_id'', true));',
      tbl
    );
  END LOOP;
END $$;
