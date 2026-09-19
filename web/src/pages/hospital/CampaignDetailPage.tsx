import { useState } from "react";
import { useParams } from "react-router-dom";
import { Users, PhoneCall } from "lucide-react";
import { Alert } from "../../components/ui/Alert.js";
import { Badge } from "../../components/ui/Badge.js";
import { Button } from "../../components/ui/Button.js";
import { Card, CardHeader, CardTitle } from "../../components/ui/Card.js";
import { Input } from "../../components/ui/Input.js";
import { LifecycleTimeline, type LifecycleStep } from "../../components/ui/LifecycleTimeline.js";
import { PageSpinner } from "../../components/ui/Spinner.js";
import { StatTile } from "../../components/ui/StatTile.js";
import { ApiError } from "../../lib/api.js";
import { useAuth } from "../../lib/auth.js";
import { usePageTitle } from "../../lib/pageTitle.js";
import {
  useCampaign,
  useCampaignQueueHealth,
  useCampaignWorkloadEstimate,
  useCancelCampaign,
  useCompleteCampaign,
  useMarkCampaignReady,
  usePauseCampaign,
  useReprioritizeCampaign,
  useResumeCampaign,
  useStartCampaign,
} from "../../lib/queries.js";
import { QUEUE_STATUS_GROUPS, queueTaskStatusVariant } from "../../lib/statusMaps.js";
import type { CampaignStatus } from "../../lib/types.js";

const TERMINAL_STATUSES: CampaignStatus[] = ["completed", "cancelled", "failed"];

// The canonical happy-path (PRD §8's lifecycle table) — "paused" is a real
// status but a branch off "running" rather than a forward step, handled via
// `branch` below rather than as its own stepper node.
const CAMPAIGN_STEPS: LifecycleStep[] = [
  { key: "draft", label: "Draft" },
  { key: "ready", label: "Ready" },
  { key: "scheduled", label: "Scheduled" },
  { key: "running", label: "Running" },
  { key: "completed", label: "Completed" },
];

export function CampaignDetailPage() {
  const { campaignId = "" } = useParams();
  const { user } = useAuth();
  const canManage = user?.role === "HOSPITAL_ADMIN" || user?.role === "CAMPAIGN_MANAGER";

  const { data: campaign, isLoading } = useCampaign(campaignId);
  const { data: estimate, isLoading: estimateLoading } = useCampaignWorkloadEstimate(campaignId);
  const { data: queueHealth } = useCampaignQueueHealth(campaignId);
  const markReady = useMarkCampaignReady(campaignId);
  const start = useStartCampaign(campaignId);
  const pause = usePauseCampaign(campaignId);
  const resume = useResumeCampaign(campaignId);
  const cancel = useCancelCampaign(campaignId);
  const complete = useCompleteCampaign(campaignId);
  const reprioritize = useReprioritizeCampaign(campaignId);

  const [priorityInput, setPriorityInput] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  usePageTitle(campaign?.name ?? "Campaign");

  if (isLoading || !campaign) return <PageSpinner />;

  const priority = priorityInput ?? campaign.priority;
  const isTerminal = TERMINAL_STATUSES.includes(campaign.status);

  async function runAction(mutateAsync: () => Promise<unknown>) {
    setActionError(null);
    try {
      await mutateAsync();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "That action could not be completed.");
    }
  }

  const isOffPathTerminal = campaign.status === "cancelled" || campaign.status === "failed";

  return (
    <div className="flex flex-col gap-ds-lg">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <LifecycleTimeline
            steps={CAMPAIGN_STEPS}
            current={campaign.status}
            branch={campaign.status === "paused" ? { atKey: "running", label: "Paused" } : null}
            offPathLabel={isOffPathTerminal ? (campaign.status === "cancelled" ? "Cancelled" : "Failed") : null}
          />
          <span className="whitespace-nowrap text-caption text-ink-muted-48">
            {campaign.followUpWindowHours}h follow-up window
          </span>
        </div>
      </Card>

      {actionError ? <Alert>{actionError}</Alert> : null}

      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          {campaign.status === "draft" && (
            <Button size="sm" onClick={() => runAction(() => markReady.mutateAsync())} disabled={markReady.isPending}>
              Mark ready
            </Button>
          )}
          {(campaign.status === "ready" || campaign.status === "scheduled") && (
            <Button size="sm" onClick={() => runAction(() => start.mutateAsync())} disabled={start.isPending}>
              {campaign.status === "scheduled" ? "Start now" : "Start"}
            </Button>
          )}
          {campaign.status === "running" && (
            <Button size="sm" variant="secondary" onClick={() => runAction(() => pause.mutateAsync())} disabled={pause.isPending}>
              Pause
            </Button>
          )}
          {campaign.status === "paused" && (
            <Button size="sm" onClick={() => runAction(() => resume.mutateAsync())} disabled={resume.isPending}>
              Resume
            </Button>
          )}
          {(campaign.status === "running" || campaign.status === "paused") && (
            <Button size="sm" variant="secondary" onClick={() => runAction(() => complete.mutateAsync())} disabled={complete.isPending}>
              Mark complete
            </Button>
          )}
          {!isTerminal && (
            <Button size="sm" variant="ghost" onClick={() => runAction(() => cancel.mutateAsync())} disabled={cancel.isPending}>
              Cancel campaign
            </Button>
          )}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-ds-lg lg:grid-cols-12">
        <div className="flex flex-col gap-ds-lg lg:col-span-8">
          <div className="grid grid-cols-1 gap-ds-md sm:grid-cols-2">
            <StatTile
              label="Eligible patients"
              value={estimateLoading ? "…" : (estimate?.eligiblePatientCount ?? 0)}
              icon={<Users className="h-5 w-5" />}
            />
            <StatTile
              label="Expected attempts (upper bound)"
              value={estimateLoading ? "…" : (estimate?.expectedAttempts ?? 0)}
              icon={<PhoneCall className="h-5 w-5" />}
            />
          </div>

          <Card accent="primary">
            <CardHeader>
              <CardTitle>Queue</CardTitle>
              <div className="flex gap-2">
                {queueHealth && queueHealth.tasksNearCutoff > 0 ? (
                  <Badge variant="warning">{queueHealth.tasksNearCutoff} near clinical cutoff</Badge>
                ) : null}
                {queueHealth && queueHealth.stuckTasksCount > 0 ? (
                  <Badge variant="critical">{queueHealth.stuckTasksCount} stuck (crashed worker?)</Badge>
                ) : null}
              </div>
            </CardHeader>
            {!queueHealth || Object.keys(queueHealth.byStatus).length === 0 ? (
              <p className="text-caption text-ink-muted-48">
                No outreach tasks yet — tasks are enqueued when the campaign starts or resumes.
              </p>
            ) : (
              <div className="flex flex-col gap-ds-sm">
                {QUEUE_STATUS_GROUPS.map((group) => {
                  const entries = group.statuses
                    .filter((status) => queueHealth.byStatus[status])
                    .map((status) => [status, queueHealth.byStatus[status]] as const);
                  if (entries.length === 0) return null;
                  return (
                    <div key={group.key} className="flex flex-wrap items-center gap-2">
                      <span className="w-32 shrink-0 text-caption text-ink-muted-48">{group.label}</span>
                      {entries.map(([status, count]) => (
                        <Badge key={status} variant={queueTaskStatusVariant(status)}>
                          {status.replace(/_/g, " ")}: {count}
                        </Badge>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
            {queueHealth?.oldestPendingScheduledFor ? (
              <p className="mt-3 text-caption text-ink-muted-48">
                Oldest pending task scheduled for{" "}
                <span className="text-ink">{new Date(queueHealth.oldestPendingScheduledFor).toLocaleString()}</span>
              </p>
            ) : null}
            <p className="mt-3 text-fine-print text-ink-muted-48">
              This is the hospital's whole queue (shared across its running campaigns), not just this one — updates
              every few seconds.
            </p>
          </Card>
        </div>

        <div className="flex flex-col gap-ds-lg lg:col-span-4">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <dl className="flex flex-col gap-ds-sm text-body">
              <div>
                <dt className="text-caption text-ink-muted-48">Description</dt>
                <dd>{campaign.description ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-caption text-ink-muted-48">Calling hours</dt>
                <dd>
                  {campaign.callingHoursStart ?? "hospital default"}–{campaign.callingHoursEnd ?? "hospital default"}
                </dd>
              </div>
              <div>
                <dt className="text-caption text-ink-muted-48">Care settings</dt>
                <dd className="capitalize">{campaign.eligibilityCriteria.careSettings?.join(", ") || "any"}</dd>
              </div>
              <div>
                <dt className="text-caption text-ink-muted-48">Risk level range</dt>
                <dd>
                  {campaign.eligibilityCriteria.minRiskLevel ?? 1}–{campaign.eligibilityCriteria.maxRiskLevel ?? 5}
                </dd>
              </div>
            </dl>

            {canManage && !isTerminal ? (
              <div className="mt-ds-lg flex items-end gap-2 border-t border-hairline pt-ds-md">
                <div>
                  <label htmlFor="priority" className="mb-1.5 block text-caption-strong text-ink-muted-80">
                    Priority (1 highest – 5 lowest)
                  </label>
                  <Input
                    id="priority"
                    type="number"
                    min={1}
                    max={5}
                    className="w-24"
                    value={priority}
                    onChange={(e) => setPriorityInput(Number(e.target.value))}
                  />
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => runAction(() => reprioritize.mutateAsync(priority))}
                  disabled={reprioritize.isPending}
                >
                  Save priority
                </Button>
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}
