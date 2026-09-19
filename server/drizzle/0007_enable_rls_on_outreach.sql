-- Same second-layer tenant isolation as prior migrations (see 0001's
-- comments), extended to the Phase 3 queue tables. app_runtime already has
-- table grants from 0001's ALTER DEFAULT PRIVILEGES.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['outreach_tasks', 'outreach_attempts']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (hospital_id = current_setting(''app.current_hospital_id'', true));',
      tbl
    );
  END LOOP;
END $$;
