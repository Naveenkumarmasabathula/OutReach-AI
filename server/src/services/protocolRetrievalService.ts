import { and, eq } from "drizzle-orm";
import { protocols, type Protocol, type ProtocolCategory } from "../db/schema/index.js";
import { withHospitalScope, type HospitalScope } from "../db/scope.js";

export interface ProtocolRetrievalQuery {
  category?: ProtocolCategory;
  tags?: string[];
  keywords?: string;
}

export interface ScoredProtocol {
  protocol: Protocol;
  score: number;
  matchedOn: string[];
}

const CATEGORY_MATCH_WEIGHT = 10;
const TAG_MATCH_WEIGHT = 3;
const KEYWORD_MATCH_WEIGHT = 1;

/**
 * Pure, synchronous, explainable relevance scoring — mirrors the eligibility
 * and priority engines' separation of "the rule" from "the query" (PRD §5's
 * retrieval must be "task-specific, not a dump" is exactly the kind of thing
 * that needs to be testable without a database). A protocol that matches
 * nothing in the query scores 0 and is excluded, so an empty/irrelevant query
 * never returns the hospital's entire protocol library.
 *
 * This is intentionally keyword/tag matching, not semantic/embedding search —
 * see docs/protocols-knowledge-retrieval.md for why that's enough for now and
 * how a vector-search implementation could replace just this function later
 * without changing callers (same swap-in pattern as EHRInterface/MockEHR).
 */
export function scoreProtocolRelevance(
  protocol: Protocol,
  query: ProtocolRetrievalQuery,
): ScoredProtocol {
  let score = 0;
  const matchedOn: string[] = [];

  if (query.category && protocol.category === query.category) {
    score += CATEGORY_MATCH_WEIGHT;
    matchedOn.push(`category:${protocol.category}`);
  }

  if (query.tags && query.tags.length > 0) {
    const protocolTags = new Set(protocol.tags.map((t) => t.toLowerCase()));
    for (const tag of query.tags) {
      if (protocolTags.has(tag.toLowerCase())) {
        score += TAG_MATCH_WEIGHT;
        matchedOn.push(`tag:${tag}`);
      }
    }
  }

  if (query.keywords && query.keywords.trim().length > 0) {
    const haystack = `${protocol.title} ${protocol.content}`.toLowerCase();
    const words = query.keywords
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    for (const word of words) {
      if (haystack.includes(word)) {
        score += KEYWORD_MATCH_WEIGHT;
        matchedOn.push(`keyword:${word}`);
      }
    }
  }

  return { protocol, score, matchedOn };
}

/**
 * Ranks candidates highest-score-first, dropping zero-score (no genuine
 * match) entries and applying the caller's task-specific limit — never
 * returns "everything" by default.
 */
export function rankProtocolsByRelevance(
  candidates: Protocol[],
  query: ProtocolRetrievalQuery,
  limit: number,
): ScoredProtocol[] {
  return candidates
    .map((protocol) => scoreProtocolRelevance(protocol, query))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

const DEFAULT_RETRIEVAL_LIMIT = 5;

/**
 * The DB-backed retrieval entry point — this is the seam Phase 5's AI agents
 * call as a controlled tool (patient/task context in, a short, source-cited
 * protocol list out). Only ever queries the caller's own hospital (RLS-forced
 * table, plus the explicit filter below per the project's belt-and-suspenders
 * convention) and only ever active protocols.
 */
export async function retrieveRelevantProtocols(
  scope: HospitalScope,
  query: ProtocolRetrievalQuery,
  limit: number = DEFAULT_RETRIEVAL_LIMIT,
): Promise<ScoredProtocol[]> {
  const candidates = await withHospitalScope(scope, (tx) =>
    tx
      .select()
      .from(protocols)
      .where(and(eq(protocols.hospitalId, scope.hospitalId), eq(protocols.isActive, true))),
  );

  return rankProtocolsByRelevance(candidates, query, limit);
}
