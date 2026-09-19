import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Alert } from "../../components/ui/Alert.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { Field, FieldLabel } from "../../components/ui/FieldLabel.js";
import { Input } from "../../components/ui/Input.js";
import { Select } from "../../components/ui/Select.js";
import { Textarea } from "../../components/ui/Textarea.js";
import { ApiError } from "../../lib/api.js";
import { usePageTitle } from "../../lib/pageTitle.js";
import { useCreateProtocol } from "../../lib/queries.js";
import { protocolCategoryLabel } from "../../lib/statusMaps.js";
import type { ProtocolCategory } from "../../lib/types.js";

const CATEGORIES: ProtocolCategory[] = [
  "follow_up_questions",
  "red_flag_indicator",
  "specialty_instruction",
  "patient_guidance",
  "escalation_contact",
  "operational_rule",
];

export function CreateProtocolPage() {
  usePageTitle("New protocol");
  const navigate = useNavigate();
  const createProtocol = useCreateProtocol();

  const [category, setCategory] = useState<ProtocolCategory>("follow_up_questions");
  const [title, setTitle] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [content, setContent] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const protocol = await createProtocol.mutateAsync({
        category,
        title,
        tags: tagsInput
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        content,
        sourceReference,
      });
      navigate(`/protocols/${protocol.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the protocol.");
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
          <FieldLabel htmlFor="category" required>
            Category
          </FieldLabel>
          <Select id="category" value={category} onChange={(e) => setCategory(e.target.value as ProtocolCategory)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {protocolCategoryLabel(c)}
              </option>
            ))}
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="title" required>
            Title
          </FieldLabel>
          <Input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="tags">Tags (comma-separated — e.g. cardiac, diabetes, general)</FieldLabel>
          <Input id="tags" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="content" required>
            Content
          </FieldLabel>
          <Textarea id="content" required rows={6} value={content} onChange={(e) => setContent(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="sourceReference" required>
            Source / protocol reference
          </FieldLabel>
          <Input
            id="sourceReference"
            required
            placeholder="e.g. Cardiology Post-Discharge Protocol v3"
            value={sourceReference}
            onChange={(e) => setSourceReference(e.target.value)}
          />
        </Field>

        <Button type="submit" disabled={createProtocol.isPending}>
          {createProtocol.isPending ? "Creating…" : "Create protocol"}
        </Button>
      </form>
    </Card>
  );
}
