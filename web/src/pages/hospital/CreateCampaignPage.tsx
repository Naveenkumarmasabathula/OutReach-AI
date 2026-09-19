import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Alert } from "../../components/ui/Alert.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { Field, FieldLabel } from "../../components/ui/FieldLabel.js";
import { Input } from "../../components/ui/Input.js";
import { Textarea } from "../../components/ui/Textarea.js";
import { ApiError } from "../../lib/api.js";
import { usePageTitle } from "../../lib/pageTitle.js";
import { useCreateCampaign } from "../../lib/queries.js";

const CARE_SETTINGS = ["inpatient", "outpatient", "emergency", "surgical", "observation"] as const;

export function CreateCampaignPage() {
  usePageTitle("New campaign");
  const navigate = useNavigate();
  const createCampaign = useCreateCampaign();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [followUpWindowHours, setFollowUpWindowHours] = useState(72);
  const [priority, setPriority] = useState(3);
  const [careSettings, setCareSettings] = useState<string[]>([]);
  const [minRiskLevel, setMinRiskLevel] = useState<number | "">("");
  const [maxRiskLevel, setMaxRiskLevel] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);

  function toggleCareSetting(setting: string) {
    setCareSettings((prev) => (prev.includes(setting) ? prev.filter((s) => s !== setting) : [...prev, setting]));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const campaign = await createCampaign.mutateAsync({
        name,
        description: description || undefined,
        followUpWindowHours,
        priority,
        eligibilityCriteria: {
          careSettings: careSettings.length ? careSettings : undefined,
          minRiskLevel: minRiskLevel === "" ? undefined : minRiskLevel,
          maxRiskLevel: maxRiskLevel === "" ? undefined : maxRiskLevel,
        },
      });
      navigate(`/campaigns/${campaign.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the campaign.");
    }
  }

  return (
    <Card className="max-w-lg">
      <form onSubmit={handleSubmit} noValidate>
        {error ? (
          <Field>
            <Alert>{error}</Alert>
          </Field>
        ) : null}
        <Field>
          <FieldLabel htmlFor="name" required>
            Campaign name
          </FieldLabel>
          <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="description">Description</FieldLabel>
          <Textarea id="description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
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
            <FieldLabel htmlFor="priority">Priority (1 highest – 5 lowest)</FieldLabel>
            <Input
              id="priority"
              type="number"
              min={1}
              max={5}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            />
          </Field>
        </div>

        <Field>
          <FieldLabel>Eligible care settings (leave all unchecked for any)</FieldLabel>
          <div className="flex flex-wrap gap-3">
            {CARE_SETTINGS.map((setting) => (
              <label key={setting} className="flex items-center gap-1.5 text-body capitalize text-ink">
                <input
                  type="checkbox"
                  checked={careSettings.includes(setting)}
                  onChange={() => toggleCareSetting(setting)}
                />
                {setting}
              </label>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-ds-md">
          <Field>
            <FieldLabel htmlFor="minRisk">Min risk level (1–5, optional)</FieldLabel>
            <Input
              id="minRisk"
              type="number"
              min={1}
              max={5}
              value={minRiskLevel}
              onChange={(e) => setMinRiskLevel(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="maxRisk">Max risk level (1–5, optional)</FieldLabel>
            <Input
              id="maxRisk"
              type="number"
              min={1}
              max={5}
              value={maxRiskLevel}
              onChange={(e) => setMaxRiskLevel(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </Field>
        </div>

        <Button type="submit" disabled={createCampaign.isPending}>
          {createCampaign.isPending ? "Creating…" : "Create campaign"}
        </Button>
      </form>
    </Card>
  );
}
