-- Same second-layer tenant isolation as migration 0001 (see its comments),
-- extended to the "app_events" table added in migration 0015. app_runtime
-- already exists and already has table grants from 0001's
-- ALTER DEFAULT PRIVILEGES, so no role/grant setup is needed here.
ALTER TABLE app_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app_events
  USING (hospital_id = current_setting('app.current_hospital_id', true));
