import { Activity, CalendarClock, Languages, Mail, Phone, Pill, ShieldCheck, Stethoscope } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { Alert } from "../../components/ui/Alert.js";
import { Badge } from "../../components/ui/Badge.js";
import { Button } from "../../components/ui/Button.js";
import { Card, CardTitle } from "../../components/ui/Card.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { Field, FieldLabel } from "../../components/ui/FieldLabel.js";
import { Input } from "../../components/ui/Input.js";
import { Select } from "../../components/ui/Select.js";
import { PageSpinner } from "../../components/ui/Spinner.js";
import { Tabs } from "../../components/ui/Tabs.js";
import { useAuth } from "../../lib/auth.js";
import { ApiError } from "../../lib/api.js";
import { usePageTitle } from "../../lib/pageTitle.js";
import { Link } from "react-router-dom";
import { useCreateEncounter, usePatient, usePatientTimeline } from "../../lib/queries.js";
import {
  encounterStatusVariant,
  escalationPriorityVariant,
  escalationStatusVariant,
  queueTaskStatusVariant,
  riskLevelVariant,
} from "../../lib/statusMaps.js";
import type { Encounter } from "../../lib/types.js";

const CARE_SETTINGS: Encounter["careSetting"][] = ["inpatient", "outpatient", "emergency", "surgical", "observation"];

export function PatientDetailPage() {
  const { patientId = "" } = useParams();
  const { user } = useAuth();
  const canAddEncounter = user?.role === "HOSPITAL_ADMIN";
  const { data: patient, isLoading } = usePatient(patientId);
  const { data: timeline, isLoading: timelineLoading } = usePatientTimeline(patientId);
  const createEncounter = useCreateEncounter(patientId);
  const [tab, setTab] = useState("overview");

  usePageTitle(patient ? `${patient.firstName} ${patient.lastName}` : "Patient");

  const [careSetting, setCareSetting] = useState<Encounter["careSetting"]>("inpatient");
  const [followUpWindowHours, setFollowUpWindowHours] = useState(72);
  const [riskLevel, setRiskLevel] = useState(3);
  const [dischargeInstructions, setDischargeInstructions] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [showAddEncounter, setShowAddEncounter] = useState(false);

  if (isLoading || !patient) return <PageSpinner />;

  async function handleAddEncounter(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      await createEncounter.mutateAsync({
        patientId,
        careSetting,
        dischargeDate: new Date().toISOString(),
        followUpWindowHours,
        riskLevel,
        dischargeInstructions: dischargeInstructions || undefined,
      });
      setShowAddEncounter(false);
      setDischargeInstructions("");
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not add the encounter.");
    }
  }

  const mostRecentEncounter = timeline?.encounters[0] ?? null;
  const openEscalationCount = timeline?.escalations.filter((e) => e.status !== "resolved" && e.status !== "closed").length ?? 0;
  const lastAttempt = timeline?.outreachAttempts[0] ?? null;

  return (
    <div className="flex flex-col gap-ds-lg">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-ds-md">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle>
                {patient.firstName} {patient.lastName}
              </CardTitle>
              <Badge variant={patient.communicationConsent ? "good" : "neutral"}>
                {patient.communicationConsent ? "Consented" : "Opted out"}
              </Badge>
              {mostRecentEncounter ? (
                <Badge variant={riskLevelVariant(mostRecentEncounter.riskLevel)}>
                  Risk {mostRecentEncounter.riskLevel}
                </Badge>
              ) : null}
              {openEscalationCount > 0 ? <Badge variant="critical">{openEscalationCount} open escalation(s)</Badge> : null}
            </div>
            <p className="mt-1.5 text-caption text-ink-muted-48">MRN {patient.mrn}</p>
          </div>
          <div className="flex flex-wrap gap-ds-lg text-caption text-ink-muted-48">
            <span className="flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5" aria-hidden />
              {patient.phone ?? "no phone on file"}
            </span>
            <span className="flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" aria-hidden />
              {patient.email ?? "no email on file"}
            </span>
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              prefers {patient.preferredContactMethod}
            </span>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-ds-lg lg:grid-cols-12">
        <div className="flex flex-col gap-ds-lg lg:col-span-8">
          <Tabs
            tabs={[
              { key: "overview", label: "Overview" },
              { key: "timeline", label: "Timeline" },
              { key: "outreach", label: "Outreach" },
            ]}
            active={tab}
            onChange={setTab}
          />

          {tab === "overview" ? (
            <Card>
              <h2 className="text-title-sm text-ink">Patient details</h2>
              <dl className="mt-ds-md grid grid-cols-1 gap-ds-md sm:grid-cols-3">
                <div>
                  <dt className="flex items-center gap-1.5 text-caption text-ink-muted-48">
                    <CalendarClock className="h-3.5 w-3.5" aria-hidden /> Date of birth
                  </dt>
                  <dd className="mt-0.5 text-body text-ink">{patient.dateOfBirth ?? "—"}</dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1.5 text-caption text-ink-muted-48">
                    <Languages className="h-3.5 w-3.5" aria-hidden /> Preferred language
                  </dt>
                  <dd className="mt-0.5 text-body text-ink uppercase">{patient.preferredLanguage}</dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1.5 text-caption text-ink-muted-48">
                    <Activity className="h-3.5 w-3.5" aria-hidden /> Most recent care setting
                  </dt>
                  <dd className="mt-0.5 text-body capitalize text-ink">{mostRecentEncounter?.careSetting ?? "—"}</dd>
                </div>
              </dl>
            </Card>
          ) : tab === "outreach" ? (
            timelineLoading || !timeline ? (
              <PageSpinner />
            ) : (
              <div className="flex flex-col gap-ds-lg">
                <Card accent="primary">
                  <h2 className="text-title-sm text-ink">Outreach status</h2>
                  {timeline.outreachTasks.length === 0 ? (
                    <p className="mt-2 text-body text-ink-muted-48">No outreach tasks yet.</p>
                  ) : (
                    <div className="mt-ds-md flex flex-col gap-2">
                      {timeline.outreachTasks.map((task) => (
                        <div key={task.id} className="flex items-center justify-between">
                          <Badge variant={queueTaskStatusVariant(task.status)}>{task.status.replace(/_/g, " ")}</Badge>
                          <span className="text-caption text-ink-muted-48">
                            {task.attemptCount} attempt(s) · deadline {new Date(task.clinicalDeadline).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card>
                  <h2 className="text-title-sm text-ink">Call history / outcomes</h2>
                  {timeline.outreachAttempts.length === 0 ? (
                    <p className="mt-2 text-body text-ink-muted-48">No call attempts yet.</p>
                  ) : (
                    <div className="mt-ds-md flex flex-col gap-2">
                      {timeline.outreachAttempts.map((attempt) => (
                        <div key={attempt.id} className="flex items-center justify-between text-body text-ink">
                          <span>
                            Attempt {attempt.attemptNumber}: {attempt.outcome.replace(/_/g, " ")}
                          </span>
                          <span className="text-caption text-ink-muted-48">
                            {new Date(attempt.startedAt).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card accent="critical">
                  <h2 className="text-title-sm text-ink">Escalations</h2>
                  {timeline.escalations.length === 0 ? (
                    <p className="mt-2 text-body text-ink-muted-48">No escalations for this patient.</p>
                  ) : (
                    <div className="mt-ds-md flex flex-col gap-2">
                      {timeline.escalations.map((escalation) => (
                        <Link
                          key={escalation.id}
                          to={`/escalations/${escalation.id}`}
                          className="flex items-center justify-between text-body text-primary hover:underline"
                        >
                          <span>{escalation.trigger}</span>
                          <span className="flex gap-2">
                            <Badge variant={escalationStatusVariant(escalation.status)}>
                              {escalation.status.replace(/_/g, " ")}
                            </Badge>
                            <Badge variant={escalationPriorityVariant(escalation.priority)}>
                              P{escalation.priority}
                            </Badge>
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            )
          ) : (
            <div className="flex flex-col gap-ds-lg">
              {canAddEncounter ? (
                <div>
                  {showAddEncounter ? (
                    <Card className="max-w-lg">
                      <form onSubmit={handleAddEncounter} noValidate>
                        {formError ? (
                          <div className="mb-ds-md">
                            <Alert>{formError}</Alert>
                          </div>
                        ) : null}
                        <Field>
                          <FieldLabel htmlFor="careSetting">Care setting</FieldLabel>
                          <Select
                            id="careSetting"
                            value={careSetting}
                            onChange={(e) => setCareSetting(e.target.value as Encounter["careSetting"])}
                          >
                            {CARE_SETTINGS.map((setting) => (
                              <option key={setting} value={setting}>
                                {setting}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <div className="grid grid-cols-2 gap-ds-md">
                          <Field>
                            <FieldLabel htmlFor="followUp">Follow-up window (hours)</FieldLabel>
                            <Input
                              id="followUp"
                              type="number"
                              min={1}
                              value={followUpWindowHours}
                              onChange={(e) => setFollowUpWindowHours(Number(e.target.value))}
                            />
                          </Field>
                          <Field>
                            <FieldLabel htmlFor="risk">Risk level (1–5)</FieldLabel>
                            <Input
                              id="risk"
                              type="number"
                              min={1}
                              max={5}
                              value={riskLevel}
                              onChange={(e) => setRiskLevel(Number(e.target.value))}
                            />
                          </Field>
                        </div>
                        <Field>
                          <FieldLabel htmlFor="instructions">Discharge instructions</FieldLabel>
                          <Input
                            id="instructions"
                            value={dischargeInstructions}
                            onChange={(e) => setDischargeInstructions(e.target.value)}
                          />
                        </Field>
                        <div className="flex gap-2">
                          <Button type="submit" size="sm" disabled={createEncounter.isPending}>
                            {createEncounter.isPending ? "Saving…" : "Add encounter"}
                          </Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => setShowAddEncounter(false)}>
                            Cancel
                          </Button>
                        </div>
                      </form>
                    </Card>
                  ) : (
                    <Button size="sm" onClick={() => setShowAddEncounter(true)}>
                      Add encounter
                    </Button>
                  )}
                </div>
              ) : null}

              {timelineLoading || !timeline ? (
                <PageSpinner />
              ) : timeline.encounters.length === 0 ? (
                <EmptyState title="No encounters recorded" description="Discharge encounters will appear here." />
              ) : (
                <div className="grid grid-cols-1 gap-ds-md sm:grid-cols-2">
                  {timeline.encounters.map((encounter) => (
                    <Card key={encounter.id}>
                      <div className="flex items-center justify-between">
                        <p className="text-body-strong capitalize text-ink">{encounter.careSetting}</p>
                        <div className="flex gap-2">
                          <Badge variant={encounterStatusVariant(encounter.status)}>{encounter.status}</Badge>
                          <Badge variant={riskLevelVariant(encounter.riskLevel)}>Risk {encounter.riskLevel}</Badge>
                        </div>
                      </div>
                      <p className="mt-1.5 text-caption text-ink-muted-48">
                        Discharged {encounter.dischargeDate ? new Date(encounter.dischargeDate).toLocaleString() : "—"} ·
                        follow-up within {encounter.followUpWindowHours}h
                      </p>
                      {encounter.dischargeInstructions ? (
                        <p className="mt-2 text-body text-ink">{encounter.dischargeInstructions}</p>
                      ) : null}
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-ds-lg lg:col-span-4">
          <Card>
            <h2 className="text-title-sm text-ink">At a glance</h2>
            <dl className="mt-ds-md flex flex-col gap-ds-sm text-body">
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted-48">Encounters</dt>
                <dd className="tabular-nums text-ink">{timeline?.encounters.length ?? "—"}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted-48">Call attempts</dt>
                <dd className="tabular-nums text-ink">{timeline?.outreachAttempts.length ?? "—"}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted-48">Last contact</dt>
                <dd className="text-ink">{lastAttempt ? new Date(lastAttempt.startedAt).toLocaleDateString() : "—"}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted-48">Open escalations</dt>
                <dd className="text-ink">
                  {openEscalationCount > 0 ? <Badge variant="critical">{openEscalationCount}</Badge> : "0"}
                </dd>
              </div>
            </dl>
          </Card>

          <Card>
            <div className="flex items-center gap-2">
              <Stethoscope className="h-4 w-4 text-primary" aria-hidden />
              <h2 className="text-title-sm text-ink">Conditions</h2>
            </div>
            {!timeline || timeline.conditions.length === 0 ? (
              <p className="mt-2 text-caption text-ink-muted-48">None on file.</p>
            ) : (
              <ul className="mt-ds-md flex flex-col gap-2">
                {timeline.conditions.map((c) => (
                  <li key={c.id} className="text-body text-ink">
                    {c.description}
                    <span className="ml-1.5 text-caption text-ink-muted-48">({c.clinicalStatus})</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="flex items-center gap-2">
              <Pill className="h-4 w-4 text-primary" aria-hidden />
              <h2 className="text-title-sm text-ink">Medications</h2>
            </div>
            {!timeline || timeline.medications.length === 0 ? (
              <p className="mt-2 text-caption text-ink-muted-48">None on file.</p>
            ) : (
              <ul className="mt-ds-md flex flex-col gap-2">
                {timeline.medications.map((m) => (
                  <li key={m.id} className="flex items-center justify-between text-body text-ink">
                    <span>{m.name}</span>
                    <span className="text-caption text-ink-muted-48">
                      {m.dosage} · {m.frequency}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
