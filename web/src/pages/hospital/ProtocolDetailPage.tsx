import { useNavigate, useParams } from "react-router-dom";
import { Badge } from "../../components/ui/Badge.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { PageSpinner } from "../../components/ui/Spinner.js";
import { useAuth } from "../../lib/auth.js";
import { usePageTitle } from "../../lib/pageTitle.js";
import { useDeactivateProtocol, useProtocol } from "../../lib/queries.js";
import { protocolCategoryLabel } from "../../lib/statusMaps.js";

export function ProtocolDetailPage() {
  const { protocolId } = useParams<{ protocolId: string }>();
  const { user } = useAuth();
  const canManage = user?.role === "HOSPITAL_ADMIN";
  const { data: protocol, isLoading } = useProtocol(protocolId!);
  const deactivateProtocol = useDeactivateProtocol();
  const navigate = useNavigate();

  usePageTitle(protocol?.title ?? "Protocol");

  if (isLoading || !protocol) return <PageSpinner />;

  return (
    <div className="grid grid-cols-1 gap-ds-lg lg:grid-cols-12">
      <div className="lg:col-span-8">
        <Card>
          <div className="mb-ds-md flex items-start justify-between gap-ds-md">
            <h1 className="text-title text-ink">{protocol.title}</h1>
            {canManage && protocol.isActive ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={deactivateProtocol.isPending}
                onClick={async () => {
                  await deactivateProtocol.mutateAsync(protocol.id);
                  navigate("/protocols");
                }}
              >
                Deactivate
              </Button>
            ) : null}
          </div>
          <p className="whitespace-pre-wrap text-body text-ink">{protocol.content}</p>
        </Card>
      </div>

      <div className="lg:col-span-4">
        <Card>
          <h2 className="text-title-sm text-ink">Details</h2>
          <dl className="mt-ds-md flex flex-col gap-ds-sm">
            <div>
              <dt className="text-caption text-ink-muted-48">Status</dt>
              <dd className="mt-1">
                {protocol.isActive ? <Badge variant="good">Active</Badge> : <Badge variant="critical">Inactive</Badge>}
              </dd>
            </div>
            <div>
              <dt className="text-caption text-ink-muted-48">Category</dt>
              <dd className="mt-1">
                <Badge variant="info">{protocolCategoryLabel(protocol.category)}</Badge>
              </dd>
            </div>
            {protocol.tags.length > 0 ? (
              <div>
                <dt className="text-caption text-ink-muted-48">Tags</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {protocol.tags.map((tag) => (
                    <Badge key={tag} variant="neutral">
                      {tag}
                    </Badge>
                  ))}
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="text-caption text-ink-muted-48">Source</dt>
              <dd className="mt-0.5 text-body text-ink">{protocol.sourceReference}</dd>
            </div>
            <div>
              <dt className="text-caption text-ink-muted-48">Version</dt>
              <dd className="mt-0.5 text-body text-ink">{protocol.version}</dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  );
}
