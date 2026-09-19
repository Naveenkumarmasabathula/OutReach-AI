import { useEffect, useState, type FormEvent } from "react";
import { Alert } from "../../components/ui/Alert.js";
import { Button } from "../../components/ui/Button.js";
import { Card, CardHeader, CardTitle } from "../../components/ui/Card.js";
import { Field, FieldLabel } from "../../components/ui/FieldLabel.js";
import { Input } from "../../components/ui/Input.js";
import { PageSpinner } from "../../components/ui/Spinner.js";
import { useAuth } from "../../lib/auth.js";
import { ApiError } from "../../lib/api.js";
import { usePageTitle } from "../../lib/pageTitle.js";
import { useMyHospital, useUpdateMyHospitalConfig } from "../../lib/queries.js";

export function SettingsPage() {
  usePageTitle("Hospital settings");
  const { user } = useAuth();
  const canEdit = user?.role === "HOSPITAL_ADMIN";
  const { data: hospital, isLoading } = useMyHospital();
  const updateConfig = useUpdateMyHospitalConfig();

  const [timezone, setTimezone] = useState("");
  const [callingHoursStart, setCallingHoursStart] = useState("");
  const [callingHoursEnd, setCallingHoursEnd] = useState("");
  const [outboundCapacity, setOutboundCapacity] = useState(0);
  const [maxRetries, setMaxRetries] = useState(0);
  const [escalationReviewerTimeoutMinutes, setEscalationReviewerTimeoutMinutes] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!hospital) return;
    setTimezone(hospital.timezone);
    setCallingHoursStart(hospital.callingHoursStart);
    setCallingHoursEnd(hospital.callingHoursEnd);
    setOutboundCapacity(hospital.outboundCapacity);
    setMaxRetries(hospital.maxRetries);
    const timeout = hospital.settings?.escalationReviewerTimeoutMinutes;
    setEscalationReviewerTimeoutMinutes(typeof timeout === "number" ? timeout : 30);
  }, [hospital]);

  if (isLoading || !hospital) return <PageSpinner />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await updateConfig.mutateAsync({
        timezone,
        callingHoursStart,
        callingHoursEnd,
        outboundCapacity,
        maxRetries,
        settings: { escalationReviewerTimeoutMinutes },
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save configuration.");
    }
  }

  return (
    <div className="grid grid-cols-1 gap-ds-lg lg:grid-cols-12">
      <div className="lg:col-span-7">
        <Card>
          <CardHeader>
            <CardTitle>{hospital.name}</CardTitle>
          </CardHeader>
          <fieldset disabled={!canEdit} className="disabled:opacity-70">
            <form onSubmit={handleSubmit} noValidate>
              {error ? (
                <div className="mb-ds-md">
                  <Alert>{error}</Alert>
                </div>
              ) : null}
              {saved ? (
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
              <Field>
                <FieldLabel htmlFor="reviewerTimeout">
                  Escalation reviewer timeout (minutes before escalating to backup review)
                </FieldLabel>
                <Input
                  id="reviewerTimeout"
                  type="number"
                  min={1}
                  value={escalationReviewerTimeoutMinutes}
                  onChange={(e) => setEscalationReviewerTimeoutMinutes(Number(e.target.value))}
                />
              </Field>
              {canEdit ? (
                <Button type="submit" size="sm" disabled={updateConfig.isPending}>
                  {updateConfig.isPending ? "Saving…" : "Save configuration"}
                </Button>
              ) : (
                <p className="text-caption text-ink-muted-48">Only a Hospital Admin can edit this configuration.</p>
              )}
            </form>
          </fieldset>
        </Card>
      </div>

      <div className="lg:col-span-5">
        <Card>
          <h2 className="text-title-sm text-ink">What these settings control</h2>
          <dl className="mt-ds-md flex flex-col gap-ds-md text-body">
            <div>
              <dt className="text-caption-strong text-ink-muted-80">Timezone & calling hours</dt>
              <dd className="mt-0.5 text-ink-muted-48">
                The default window outbound calls are allowed in — campaigns may narrow this further but never widen
                it.
              </dd>
            </div>
            <div>
              <dt className="text-caption-strong text-ink-muted-80">Outbound capacity</dt>
              <dd className="mt-0.5 text-ink-muted-48">
                The hard concurrency limit the queue enforces centrally, even across multiple worker processes.
              </dd>
            </div>
            <div>
              <dt className="text-caption-strong text-ink-muted-80">Max retries</dt>
              <dd className="mt-0.5 text-ink-muted-48">
                How many attempts a task gets before it becomes a manual follow-up task and a staff notification
                fires.
              </dd>
            </div>
            <div>
              <dt className="text-caption-strong text-ink-muted-80">Escalation reviewer timeout</dt>
              <dd className="mt-0.5 text-ink-muted-48">
                If no reviewer acknowledges an open escalation within this window, it automatically escalates to a
                backup reviewer.
              </dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  );
}
