import { AlertOctagon, Bot, Gauge } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/Badge.js";
import { Card } from "../../components/ui/Card.js";
import { PageSpinner } from "../../components/ui/Spinner.js";
import { StatTile } from "../../components/ui/StatTile.js";
import { Table, TBody, TD, TH, THead, TR } from "../../components/ui/Table.js";
import { usePageTitle } from "../../lib/pageTitle.js";
import { usePlatformAnalytics } from "../../lib/queries.js";

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function formatMs(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}ms`;
}

/**
 * PRD §20: "Platform Admin dashboard: authorized aggregate visibility
 * across hospitals — activity, campaign volume, queue health, AI usage,
 * errors, escalation statistics, system performance — but aggregate
 * analytics must never bypass patient-level access controls." This page
 * only ever renders hospital-level aggregate numbers from
 * `getPlatformAggregateAnalytics` (server/src/services/analyticsService.ts)
 * — there is no patient-identifying data anywhere in that response to
 * render, by construction, not by care taken here.
 *
 * AI usage reads as all-zero/"—" until `ai/pipeline.ts` has processed at
 * least one real call after `recordAiCall` was wired in — the table and
 * aggregation are live, not stubbed; see docs/dashboards-analytics.md.
 */
export function PlatformDashboardPage() {
  usePageTitle("Platform overview");
  const { data: analytics, isLoading } = usePlatformAnalytics();

  if (isLoading || !analytics) return <PageSpinner />;

  return (
    <div className="flex flex-col gap-ds-lg">
      <div className="grid grid-cols-1 gap-ds-md sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Hospitals" value={analytics.hospitalCount} />
        <StatTile label="Campaigns" value={analytics.totals.campaignCount} />
        <StatTile
          label="Active calls"
          value={`${analytics.totals.activeCalls} / ${analytics.totals.outboundCapacity}`}
        />
        <StatTile label="Escalations" value={analytics.totals.escalationCount} />
      </div>

      <div className="grid grid-cols-1 gap-ds-lg lg:grid-cols-3">
        <Card>
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <h2 className="text-title-sm text-ink">AI usage</h2>
          </div>
          <div className="mt-ds-md flex flex-col gap-1.5 text-body text-ink">
            <div className="flex items-center justify-between">
              <span>Total calls</span>
              <span className="tabular-nums">{analytics.aiUsage.totalCalls}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Success rate</span>
              <span className="tabular-nums">{formatPercent(analytics.aiUsage.successRate)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Avg. latency</span>
              <span className="tabular-nums">{formatMs(analytics.aiUsage.averageLatencyMs)}</span>
            </div>
          </div>
        </Card>

        <Card accent="warning">
          <div className="flex items-center gap-2">
            <AlertOctagon className="h-4 w-4 text-status-serious" />
            <h2 className="text-title-sm text-ink">Errors</h2>
          </div>
          <div className="mt-ds-md flex flex-col gap-1.5 text-body text-ink">
            <div className="flex items-center justify-between">
              <span>Failed tasks</span>
              <span className="tabular-nums">{analytics.errors.failedTaskCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Technical failures</span>
              <span className="tabular-nums">{analytics.errors.technicalFailureCount}</span>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-primary" />
            <h2 className="text-title-sm text-ink">System performance</h2>
          </div>
          <div className="mt-ds-md flex flex-col gap-1.5 text-body text-ink">
            <div className="flex items-center justify-between">
              <span>Queue utilization</span>
              <span className="tabular-nums">{formatPercent(analytics.systemPerformance.queueUtilization)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Active calls</span>
              <span className="tabular-nums">
                {analytics.systemPerformance.activeCalls} / {analytics.systemPerformance.outboundCapacity}
              </span>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <h2 className="text-title-sm text-ink">Per-hospital summary</h2>
        <div className="mt-ds-md overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>Hospital</TH>
                <TH className="text-right">Campaigns</TH>
                <TH className="text-right">Active calls</TH>
                <TH className="text-right">Escalations</TH>
                <TH className="text-right">AI calls</TH>
                <TH className="text-right">Failed tasks</TH>
              </TR>
            </THead>
            <TBody>
              {analytics.perHospital.map((h) => (
                <TR key={h.hospitalId}>
                  <TD>
                    <Link to={`/platform/hospitals/${h.hospitalId}`} className="text-primary hover:underline">
                      {h.hospitalName}
                    </Link>
                  </TD>
                  <TD numeric>{h.campaigns.total}</TD>
                  <TD numeric>
                    {h.capacity.activeCalls} / {h.capacity.outboundCapacity}
                  </TD>
                  <TD numeric>
                    {h.escalations.total > 0 ? (
                      <Badge variant="warning">{h.escalations.total}</Badge>
                    ) : (
                      h.escalations.total
                    )}
                  </TD>
                  <TD numeric>{h.aiUsage.totalCalls}</TD>
                  <TD numeric>
                    {h.errors.failedTaskCount > 0 ? (
                      <Badge variant="critical">{h.errors.failedTaskCount}</Badge>
                    ) : (
                      h.errors.failedTaskCount
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
