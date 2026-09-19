-- Same second-layer tenant isolation as migration 0001 (see its comments),
-- extended to the "audit_log" table added in migration 0010. app_runtime
-- already exists and already has table grants from 0001's
-- ALTER DEFAULT PRIVILEGES, so no role/grant setup is needed here.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log
  USING (hospital_id = current_setting('app.current_hospital_id', true));
