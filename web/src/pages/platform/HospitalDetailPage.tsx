import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { Alert } from "../../components/ui/Alert.js";
import { Badge } from "../../components/ui/Badge.js";
import { Button } from "../../components/ui/Button.js";
import { Card, CardHeader, CardTitle } from "../../components/ui/Card.js";
import { Field, FieldLabel } from "../../components/ui/FieldLabel.js";
import { Input } from "../../components/ui/Input.js";
import { Select } from "../../components/ui/Select.js";
import { PageSpinner } from "../../components/ui/Spinner.js";
import { ApiError } from "../../lib/api.js";
import { usePageTitle } from "../../lib/pageTitle.js";
import {
  useCreatePlatformHospitalStaff,
  useMarkHospitalReady,
  usePlatformHospital,
  useUpdatePlatformHospitalConfig,
} from "../../lib/queries.js";
import { hospitalStatusVariant } from "../../lib/statusMaps.js";

export function HospitalDetailPage() {
  const { hospitalId = "" } = useParams();
  const { data: hospital, isLoading } = usePlatformHospital(hospitalId);
  const updateConfig = useUpdatePlatformHospitalConfig(hospitalId);
  const markReady = useMarkHospitalReady(hospitalId);
  const createStaff = useCreatePlatformHospitalStaff(hospitalId);

  usePageTitle(hospital?.name ?? "Hospital");

  const [timezone, setTimezone] = useState("");
  const [callingHoursStart, setCallingHoursStart] = useState("");
  const [callingHoursEnd, setCallingHoursEnd] = useState("");
  const [outboundCapacity, setOutboundCapacity] = useState(0);
  const [maxRetries, setMaxRetries] = useState(0);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configSaved, setConfigSaved] = useState(false);

  const [staffEmail, setStaffEmail] = useState("");
  const [staffName, setStaffName] = useState("");
  const [staffPassword, setStaffPassword] = useState("");
  const [staffRole, setStaffRole] = useState<"HOSPITAL_ADMIN" | "CAMPAIGN_MANAGER" | "CLINICAL_REVIEWER">(
    "HOSPITAL_ADMIN",
  );
  const [staffError, setStaffError] = useState<string | null>(null);
  const [staffCreated, setStaffCreated] = useState<string | null>(null);

  useEffect(() => {
    if (!hospital) return;
    setTimezone(hospital.timezone);
    setCallingHoursStart(hospital.callingHoursStart);
    setCallingHoursEnd(hospital.callingHoursEnd);
    setOutboundCapacity(hospital.outboundCapacity);
    setMaxRetries(hospital.maxRetries);
  }, [hospital]);

  if (isLoading || !hospital) return <PageSpinner />;

  async function handleSaveConfig(e: FormEvent) {
    e.preventDefault();
    setConfigError(null);
    setConfigSaved(false);
    try {
      await updateConfig.mutateAsync({
        timezone,
        callingHoursStart,
        callingHoursEnd,
        outboundCapacity,
        maxRetries,
      });
      setConfigSaved(true);
    } catch (err) {
      setConfigError(err instanceof ApiError ? err.message : "Could not save configuration.");
    }
  }

  async function handleCreateStaff(e: FormEvent) {
    e.preventDefault();
    setStaffError(null);
    setStaffCreated(null);
    try {
      const user = await createStaff.mutateAsync({
        email: staffEmail,
        password: staffPassword,
        name: staffName,
        role: staffRole,
      });
      setStaffCreated(`${user.name} (${user.role}) created.`);
      setStaffEmail("");
      setStaffName("");
      setStaffPassword("");
    } catch (err) {
      setStaffError(err instanceof ApiError ? err.message : "Could not create the staff user.");
    }
  }

  return (
    <div className="flex flex-col gap-ds-lg">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-ds-md">
          <div className="flex items-center gap-3">
            <CardTitle>{hospital.name}</CardTitle>
            <Badge variant={hospitalStatusVariant(hospital.status)}>{hospital.status}</Badge>
            <span className="text-caption text-ink-muted-48">{hospital.slug}</span>
          </div>
          {hospital.status === "draft" ? (
            <Button size="sm" onClick={() => markReady.mutate()} disabled={markReady.isPending}>
              {markReady.isPending ? "Marking ready…" : "Mark ready for campaigns"}
            </Button>
          ) : null}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-ds-lg lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
          </CardHeader>
          <form onSubmit={handleSaveConfig} noValidate>
            {configError ? (
              <div className="mb-ds-md">
                <Alert>{configError}</Alert>
              </div>
            ) : null}
            {configSaved ? (
              <div className="mb-ds-md">
                <Alert variant="success">Configuration saved.</Alert>
              </div>
            ) : null}
            <Field>
              <FieldLabel htmlFor="timezone">Timezone</FieldLabel>
              <Input id="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-ds-md">
              <Field>
                <FieldLabel htmlFor="hoursStart">Calling hours start</FieldLabel>
                <Input
                  id="hoursStart"
                  value={callingHoursStart}
                  onChange={(e) => setCallingHoursStart(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="hoursEnd">Calling hours end</FieldLabel>
                <Input id="hoursEnd" value={callingHoursEnd} onChange={(e) => setCallingHoursEnd(e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-ds-md">
              <Field>
                <FieldLabel htmlFor="capacity">Outbound capacity</FieldLabel>
                <Input
                  id="capacity"
                  type="number"
                  min={1}
                  value={outboundCapacity}
                  onChange={(e) => setOutboundCapacity(Number(e.target.value))}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="retries">Max retries</FieldLabel>
                <Input
                  id="retries"
                  type="number"
                  min={0}
                  value={maxRetries}
                  onChange={(e) => setMaxRetries(Number(e.target.value))}
                />
              </Field>
            </div>
            <Button type="submit" size="sm" disabled={updateConfig.isPending}>
              {updateConfig.isPending ? "Saving…" : "Save configuration"}
            </Button>
          </form>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Add staff user</CardTitle>
          </CardHeader>
          <form onSubmit={handleCreateStaff} noValidate>
            {staffError ? (
              <div className="mb-ds-md">
                <Alert>{staffError}</Alert>
              </div>
            ) : null}
            {staffCreated ? (
              <div className="mb-ds-md">
                <Alert variant="success">{staffCreated}</Alert>
              </div>
            ) : null}
            <Field>
              <FieldLabel htmlFor="staffName" required>
                Name
              </FieldLabel>
              <Input id="staffName" required value={staffName} onChange={(e) => setStaffName(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="staffEmail" required>
                Email
              </FieldLabel>
              <Input
                id="staffEmail"
                type="email"
                required
                value={staffEmail}
                onChange={(e) => setStaffEmail(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="staffPassword" required>
                Temporary password
              </FieldLabel>
              <Input
                id="staffPassword"
                type="password"
                required
                minLength={8}
                value={staffPassword}
                onChange={(e) => setStaffPassword(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="staffRole">Role</FieldLabel>
              <Select
                id="staffRole"
                value={staffRole}
                onChange={(e) => setStaffRole(e.target.value as typeof staffRole)}
              >
                <option value="HOSPITAL_ADMIN">Hospital Admin</option>
                <option value="CAMPAIGN_MANAGER">Campaign Manager</option>
                <option value="CLINICAL_REVIEWER">Clinical Reviewer</option>
              </Select>
            </Field>
            <Button type="submit" size="sm" disabled={createStaff.isPending}>
              {createStaff.isPending ? "Creating…" : "Create staff user"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
