-- Same second-layer tenant isolation as migration 0001 (see its comments),
-- extended to the "ai_call_log" table added in migration 0017. app_runtime
-- already exists and already has table grants from 0001's
-- ALTER DEFAULT PRIVILEGES, so no role/grant setup is needed here.
ALTER TABLE ai_call_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_call_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_call_log
  USING (hospital_id = current_setting('app.current_hospital_id', true));
