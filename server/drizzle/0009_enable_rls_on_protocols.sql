-- Same second-layer tenant isolation as migration 0001 (see its comments),
-- extended to the "protocols" table added in migration 0008. app_runtime
-- already exists and already has table grants from 0001's
-- ALTER DEFAULT PRIVILEGES, so no role/grant setup is needed here.
ALTER TABLE protocols ENABLE ROW LEVEL SECURITY;
ALTER TABLE protocols FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON protocols
  USING (hospital_id = current_setting('app.current_hospital_id', true));
