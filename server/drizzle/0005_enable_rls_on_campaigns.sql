-- Same second-layer tenant isolation as migrations 0001/0003 (see 0001's
-- comments), extended to "campaigns". app_runtime already has table grants
-- from 0001's ALTER DEFAULT PRIVILEGES.
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON campaigns
  USING (hospital_id = current_setting('app.current_hospital_id', true));
