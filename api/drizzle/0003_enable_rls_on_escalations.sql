-- Same second-layer tenant isolation as migration 0001 (see its comments),
-- extended to the "escalations" table added in migration 0002. app_runtime
-- already exists and already has table grants from 0001's
-- ALTER DEFAULT PRIVILEGES, so no role/grant setup is needed here.
ALTER TABLE escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON escalations
  USING (hospital_id = current_setting('app.current_hospital_id', true));
