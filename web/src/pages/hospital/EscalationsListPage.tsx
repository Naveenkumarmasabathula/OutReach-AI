import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/Badge.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { Select } from "../../components/ui/Select.js";
import { PageSpinner } from "../../components/ui/Spinner.js";
import { Table, TBody, TD, TH, THead, TR } from "../../components/ui/Table.js";
import { usePageTitle } from "../../lib/pageTitle.js";
import { useEscalations } from "../../lib/queries.js";
import { escalationPriorityVariant, escalationStatusVariant } from "../../lib/statusMaps.js";
import type { EscalationStatus } from "../../lib/types.js";

const STATUS_OPTIONS: { value: EscalationStatus | ""; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "assigned", label: "Assigned" },
  { value: "in_review", label: "In review" },
  { value: "waiting_for_information", label: "Waiting for information" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

export function EscalationsListPage() {
  usePageTitle("Escalations");
  const [status, setStatus] = useState<EscalationStatus | "">("");
  const { data: escalations, isLoading } = useEscalations(status ? { status } : {});

  if (isLoading || !escalations) return <PageSpinner />;

  return (
    <div>
      <div className="mb-ds-lg flex items-center justify-between">
        <p className="text-body text-ink-muted-48">{escalations.length} escalation(s)</p>
        <Select value={status} onChange={(e) => setStatus(e.target.value as EscalationStatus | "")} className="w-56">
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </div>

      {escalations.length === 0 ? (
        <EmptyState
          title="No escalations"
          description="Escalations created by the AI triage/consensus pipeline, or forced during a queue simulation, will show up here for clinical review."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Trigger</TH>
              <TH>Status</TH>
              <TH>Priority</TH>
              <TH>Created</TH>
            </TR>
          </THead>
          <TBody>
            {escalations.map((escalation) => (
              <TR key={escalation.id}>
                <TD>
                  <Link to={`/escalations/${escalation.id}`} className="text-primary hover:underline">
                    {escalation.trigger}
                  </Link>
                </TD>
                <TD>
                  <Badge variant={escalationStatusVariant(escalation.status)}>
                    {escalation.status.replace(/_/g, " ")}
                  </Badge>
                </TD>
                <TD>
                  <Badge variant={escalationPriorityVariant(escalation.priority)}>P{escalation.priority}</Badge>
                </TD>
                <TD className="text-ink-muted-48">{new Date(escalation.createdAt).toLocaleString()}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
