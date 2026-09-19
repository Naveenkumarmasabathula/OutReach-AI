import { Link, useParams } from "react-router-dom";
import { useState } from "react";
import { Badge } from "../../components/ui/Badge.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { Field, FieldLabel } from "../../components/ui/FieldLabel.js";
import { LifecycleTimeline, type LifecycleStep } from "../../components/ui/LifecycleTimeline.js";
import { PageSpinner } from "../../components/ui/Spinner.js";
import { Textarea } from "../../components/ui/Textarea.js";
import { useAuth } from "../../lib/auth.js";
import { usePageTitle } from "../../lib/pageTitle.js";
import {
  useAcknowledgeEscalation,
  useCloseEscalation,
  useEscalationDetail,
  useRequestInformation,
  useResolveEscalation,
  useResumeReview,
  useStartReview,
} from "../../lib/queries.js";
import { escalationPriorityVariant } from "../../lib/statusMaps.js";

// PRD §21's lifecycle table — "waiting for information" is a real status
// but a branch off "in review" (the reviewer paused to ask a question, not
// moved forward), handled via `branch` rather than as its own step. "Closed"
// is optional per the PRD, so it's the final step rather than assumed.
const ESCALATION_STEPS: LifecycleStep[] = [
  { key: "open", label: "Open" },
  { key: "assigned", label: "Assigned" },
  { key: "in_review", label: "In review" },
  { key: "resolved", label: "Resolved" },
  { key: "closed", label: "Closed" },
];

type TriageAssessment = {
  source: string;
  classification: string;
  confidence: number;
  escalationRecommended: boolean;
  reasoning: string;
  evidence: string[];
  protocolReferences: string[];
};

export function EscalationDetailPage() {
  const { escalationId } = useParams<{ escalationId: string }>();
  const { user } = useAuth();
  const canManage = user?.role === "HOSPITAL_ADMIN" || user?.role === "CLINICAL_REVIEWER";
  const { data: detail, isLoading } = useEscalationDetail(escalationId!);

  const acknowledge = useAcknowledgeEscalation(escalationId!);
  const startReview = useStartReview(escalationId!);
  const resumeReview = useResumeReview(escalationId!);
  const requestInformation = useRequestInformation(escalationId!);
  const resolve = useResolveEscalation(escalationId!);
  const close = useCloseEscalation(escalationId!);

  const [infoNotes, setInfoNotes] = useState("");
  const [resolution, setResolution] = useState("");

  usePageTitle(detail ? `Escalation: ${detail.escalation.trigger}` : "Escalation");

  if (isLoading || !detail) return <PageSpinner />;

  const { escalation, patient, transcript, triageResult, consensusResult } = detail;
  const assessments = Array.isArray(triageResult) ? (triageResult as TriageAssessment[]) : [];
  const clinicalIndicatorEntries = Object.entries(escalation.clinicalIndicators ?? {}).filter(
    ([key]) => key !== "assessments" && key !== "consensusClassification",
  );

  return (
    <div className="flex flex-col gap-ds-lg">
      <Card accent={escalation.status === "open" ? "critical" : "primary"}>
        <div className="flex flex-wrap items-start justify-between gap-ds-md">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-title text-ink">{escalation.trigger}</h1>
              <Badge variant={escalationPriorityVariant(escalation.priority)}>Priority {escalation.priority}</Badge>
            </div>
            {patient ? (
              <Link to={`/patients/${patient.id}`} className="mt-1 block text-body text-primary hover:underline">
                {patient.firstName} {patient.lastName} (MRN {patient.mrn})
              </Link>
            ) : null}
          </div>
          <span className="whitespace-nowrap text-caption text-ink-muted-48">
            Opened {new Date(escalation.createdAt).toLocaleString()}
          </span>
        </div>

        <div className="mt-ds-md border-t border-hairline pt-ds-md">
          <LifecycleTimeline
            steps={ESCALATION_STEPS}
            current={escalation.status}
            branch={
              escalation.status === "waiting_for_information"
                ? { atKey: "in_review", label: "Waiting for info" }
                : null
            }
          />
        </div>

        {canManage ? (
          <div className="mt-ds-md flex flex-wrap gap-2 border-t border-hairline pt-ds-md">
            {escalation.status === "open" ? (
              <Button size="sm" disabled={acknowledge.isPending} onClick={() => acknowledge.mutateAsync(undefined)}>
                Acknowledge (assign to me)
              </Button>
            ) : null}
            {escalation.status === "assigned" ? (
              <Button size="sm" disabled={startReview.isPending} onClick={() => startReview.mutateAsync(undefined)}>
                Start review
              </Button>
            ) : null}
            {escalation.status === "waiting_for_information" ? (
              <Button size="sm" disabled={resumeReview.isPending} onClick={() => resumeReview.mutateAsync(undefined)}>
                Resume review
              </Button>
            ) : null}
            {escalation.status === "resolved" ? (
              <Button size="sm" disabled={close.isPending} onClick={() => close.mutateAsync(undefined)}>
                Close
              </Button>
            ) : null}
          </div>
        ) : null}

        {canManage && escalation.status === "in_review" ? (
          <div className="mt-ds-md grid grid-cols-1 gap-ds-md border-t border-hairline pt-ds-md sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="infoNotes">Request information</FieldLabel>
              <Textarea id="infoNotes" rows={2} value={infoNotes} onChange={(e) => setInfoNotes(e.target.value)} />
              <Button
                size="sm"
                variant="secondary"
                className="mt-2"
                disabled={!infoNotes || requestInformation.isPending}
                onClick={() => requestInformation.mutateAsync(infoNotes)}
              >
                Request information
              </Button>
            </Field>
            <Field>
              <FieldLabel htmlFor="resolution">Resolve</FieldLabel>
              <Textarea id="resolution" rows={2} value={resolution} onChange={(e) => setResolution(e.target.value)} />
              <Button
                size="sm"
                className="mt-2"
                disabled={!resolution || resolve.isPending}
                onClick={() => resolve.mutateAsync(resolution)}
              >
                Resolve
              </Button>
            </Field>
          </div>
        ) : null}

        {escalation.resolution ? (
          <p className="mt-ds-md border-t border-hairline pt-ds-md text-body text-ink">
            <span className="text-caption-strong text-ink-muted-80">Resolution: </span>
            {escalation.resolution}
          </p>
        ) : null}
      </Card>

      <div className="grid grid-cols-1 gap-ds-lg lg:grid-cols-12">
        <div className="flex flex-col gap-ds-lg lg:col-span-8">
          {consensusResult ? (
            <Card>
              <h2 className="text-title-sm text-ink">AI consensus</h2>
              <p className="mt-1 text-body text-ink">{consensusResult.rationale}</p>
              {consensusResult.disagreement ? (
                <Badge variant="warning" className="mt-2">
                  Independent assessments disagreed — conservative strategy applied
                </Badge>
              ) : null}
            </Card>
          ) : null}

          {assessments.length > 0 ? (
            <Card>
              <h2 className="text-title-sm text-ink">Independent triage assessments</h2>
              <div className="mt-ds-md grid grid-cols-1 gap-ds-md sm:grid-cols-2">
                {assessments.map((assessment, i) => (
                  <div key={i} className="rounded-md border border-hairline p-ds-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-caption-strong text-ink-muted-80">
                        {assessment.source === "rule_based" ? "Rule-based" : "AI model"}
                      </span>
                      <Badge variant={escalationPriorityVariant(assessment.escalationRecommended ? 1 : 5)}>
                        {assessment.classification}
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-body text-ink">{assessment.reasoning}</p>
                    {assessment.evidence.length > 0 ? (
                      <ul className="mt-1.5 list-inside list-disc text-caption text-ink-muted-48">
                        {assessment.evidence.map((e, j) => (
                          <li key={j}>{e}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {transcript && transcript.length > 0 ? (
            <Card>
              <h2 className="text-title-sm text-ink">Call transcript</h2>
              <div className="mt-ds-md flex flex-col gap-2">
                {transcript.map((turn, i) => (
                  <p key={i} className="text-body text-ink">
                    <span className="text-caption-strong text-ink-muted-80">
                      {turn.speaker === "agent" ? "Agent: " : "Patient: "}
                    </span>
                    {turn.text}
                  </p>
                ))}
              </div>
            </Card>
          ) : null}

          {!consensusResult && assessments.length === 0 && (!transcript || transcript.length === 0) ? (
            <Card>
              <p className="text-body text-ink-muted-48">
                No AI assessment or transcript recorded for this escalation — it was likely created directly rather
                than through the AI triage pipeline.
              </p>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-ds-lg lg:col-span-4">
          <Card>
            <h2 className="text-title-sm text-ink">Clinical indicators</h2>
            {clinicalIndicatorEntries.length === 0 ? (
              <p className="mt-2 text-caption text-ink-muted-48">None recorded.</p>
            ) : (
              <dl className="mt-ds-md flex flex-col gap-2">
                {clinicalIndicatorEntries.map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between text-body">
                    <dt className="capitalize text-ink-muted-48">{key.replace(/_/g, " ")}</dt>
                    <dd className="text-ink">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
