import { aiProvider } from "./index.js";
import { documentationRecordSchema, type DocumentationAgentInput, type DocumentationRecord } from "./types.js";

/**
 * PRD §12: converts the interaction into a structured record. Deliberately
 * thin — the actual generation is delegated to `aiProvider` (Gemini or the
 * simulated fallback), and this function's only job is the same
 * "validate before use" discipline as everywhere else AI output crosses a
 * trust boundary (re-validates even though `aiProvider.generateDocumentation`
 * already does, since a provider swap later shouldn't be trusted to have
 * re-implemented that check correctly).
 */
export async function generateCallDocumentation(input: DocumentationAgentInput): Promise<DocumentationRecord> {
  const record = await aiProvider.generateDocumentation(input);
  return documentationRecordSchema.parse(record);
}
