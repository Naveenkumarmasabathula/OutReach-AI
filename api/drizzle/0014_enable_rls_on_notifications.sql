-- Same second-layer tenant isolation as migration 0001 (see its comments),
-- extended to the "notifications" table added in migration 0013. app_runtime
-- already exists and already has table grants from 0001's
-- ALTER DEFAULT PRIVILEGES, so no role/grant setup is needed here.
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notifications
  USING (hospital_id = current_setting('app.current_hospital_id', true));
