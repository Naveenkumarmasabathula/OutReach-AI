import { Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/Badge.js";
import { Button } from "../../components/ui/Button.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { PageSpinner } from "../../components/ui/Spinner.js";
import { Table, TBody, TD, TH, THead, TR } from "../../components/ui/Table.js";
import { useAuth } from "../../lib/auth.js";
import { usePageTitle } from "../../lib/pageTitle.js";
import { useCampaigns } from "../../lib/queries.js";
import { campaignStatusVariant } from "../../lib/statusMaps.js";

export function CampaignsListPage() {
  usePageTitle("Campaigns");
  const { user } = useAuth();
  const canManage = user?.role === "HOSPITAL_ADMIN" || user?.role === "CAMPAIGN_MANAGER";
  const { data: campaigns, isLoading } = useCampaigns();

  if (isLoading || !campaigns) return <PageSpinner />;

  return (
    <div>
      <div className="mb-ds-lg flex items-center justify-between">
        <p className="text-body text-ink-muted-48">{campaigns.length} campaigns</p>
        {canManage ? (
          <Link to="/campaigns/new">
            <Button size="sm">
              <Plus className="h-4 w-4" /> New campaign
            </Button>
          </Link>
        ) : null}
      </div>

      {campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          description="Create a campaign to start post-discharge outreach for a group of patients."
          action={
            canManage ? (
              <Link to="/campaigns/new">
                <Button size="sm">
                  <Plus className="h-4 w-4" /> New campaign
                </Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Status</TH>
              <TH>Follow-up window</TH>
              <TH className="text-right">Priority</TH>
            </TR>
          </THead>
          <TBody>
            {campaigns.map((campaign) => (
              <TR key={campaign.id}>
                <TD>
                  <Link to={`/campaigns/${campaign.id}`} className="text-primary hover:underline">
                    {campaign.name}
                  </Link>
                </TD>
                <TD>
                  <Badge variant={campaignStatusVariant(campaign.status)}>{campaign.status}</Badge>
                </TD>
                <TD>{campaign.followUpWindowHours}h</TD>
                <TD numeric>{campaign.priority}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
