import { Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/Badge.js";
import { Button } from "../../components/ui/Button.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { PageSpinner } from "../../components/ui/Spinner.js";
import { Table, TBody, TD, TH, THead, TR } from "../../components/ui/Table.js";
import { useAuth } from "../../lib/auth.js";
import { usePageTitle } from "../../lib/pageTitle.js";
import { useProtocols } from "../../lib/queries.js";
import { protocolCategoryLabel } from "../../lib/statusMaps.js";

export function ProtocolsListPage() {
  usePageTitle("Protocols");
  const { user } = useAuth();
  const canManage = user?.role === "HOSPITAL_ADMIN";
  const { data: protocols, isLoading } = useProtocols();

  if (isLoading || !protocols) return <PageSpinner />;

  return (
    <div>
      <div className="mb-ds-lg flex items-center justify-between">
        <p className="text-body text-ink-muted-48">{protocols.length} active protocols</p>
        {canManage ? (
          <Link to="/protocols/new">
            <Button size="sm">
              <Plus className="h-4 w-4" /> New protocol
            </Button>
          </Link>
        ) : null}
      </div>

      {protocols.length === 0 ? (
        <EmptyState
          title="No protocols yet"
          description="Add post-discharge protocols and knowledge (follow-up questions, red-flag indicators, guidance) so outreach can retrieve them by task."
          action={
            canManage ? (
              <Link to="/protocols/new">
                <Button size="sm">
                  <Plus className="h-4 w-4" /> New protocol
                </Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Title</TH>
              <TH>Category</TH>
              <TH>Tags</TH>
              <TH>Source</TH>
              <TH className="text-right">Version</TH>
            </TR>
          </THead>
          <TBody>
            {protocols.map((protocol) => (
              <TR key={protocol.id}>
                <TD>
                  <Link to={`/protocols/${protocol.id}`} className="text-primary hover:underline">
                    {protocol.title}
                  </Link>
                </TD>
                <TD>
                  <Badge variant="info">{protocolCategoryLabel(protocol.category)}</Badge>
                </TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    {protocol.tags.map((tag) => (
                      <Badge key={tag} variant="neutral">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </TD>
                <TD className="text-ink-muted-48">{protocol.sourceReference}</TD>
                <TD numeric>{protocol.version}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
