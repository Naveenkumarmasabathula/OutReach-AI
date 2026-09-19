import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protocolCategoryEnum, protocols } from "../db/schema/index.js";
import type { HospitalScope } from "../db/scope.js";
import { withHospitalScope } from "../db/scope.js";
import { assertDefined } from "../lib/assert.js";
import { NotFoundError } from "../lib/errors.js";
import { toOffsetLimit, type Pagination } from "../lib/pagination.js";

export const createProtocolSchema = z.object({
  category: z.enum(protocolCategoryEnum.enumValues),
  title: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  content: z.string().min(1),
  sourceReference: z.string().min(1),
});
export type CreateProtocolInput = z.infer<typeof createProtocolSchema>;

export const updateProtocolSchema = createProtocolSchema.partial();
export type UpdateProtocolInput = z.infer<typeof updateProtocolSchema>;

export async function createProtocol(scope: HospitalScope, input: CreateProtocolInput) {
  return withHospitalScope(scope, async (tx) => {
    const [protocol] = await tx
      .insert(protocols)
      .values({ ...input, hospitalId: scope.hospitalId })
      .returning();
    return assertDefined(protocol, "protocol insert returned no row");
  });
}

export async function listProtocols(
  scope: HospitalScope,
  pagination: Pagination,
  filters: { category?: (typeof protocolCategoryEnum.enumValues)[number]; includeInactive?: boolean } = {},
) {
  const { offset, limit } = toOffsetLimit(pagination);
  const conditions = [eq(protocols.hospitalId, scope.hospitalId)];
  if (filters.category) conditions.push(eq(protocols.category, filters.category));
  if (!filters.includeInactive) conditions.push(eq(protocols.isActive, true));

  return withHospitalScope(scope, (tx) =>
    tx
      .select()
      .from(protocols)
      .where(and(...conditions))
      .orderBy(desc(protocols.createdAt))
      .limit(limit)
      .offset(offset),
  );
}

export async function getProtocolById(scope: HospitalScope, protocolId: string) {
  const [protocol] = await withHospitalScope(scope, (tx) =>
    tx
      .select()
      .from(protocols)
      .where(and(eq(protocols.id, protocolId), eq(protocols.hospitalId, scope.hospitalId))),
  );
  if (!protocol) throw new NotFoundError("Protocol not found");
  return protocol;
}

/**
 * Bumps `version` on every content-affecting edit — protocols are clinical
 * guidance that may already be cited by past retrievals/escalations, so an
 * edit is tracked as a new version rather than a silent overwrite (see
 * docs/protocols-knowledge-retrieval.md).
 */
export async function updateProtocol(
  scope: HospitalScope,
  protocolId: string,
  input: UpdateProtocolInput,
) {
  return withHospitalScope(scope, async (tx) => {
    const [existing] = await tx
      .select()
      .from(protocols)
      .where(and(eq(protocols.id, protocolId), eq(protocols.hospitalId, scope.hospitalId)));
    if (!existing) throw new NotFoundError("Protocol not found");

    const [updated] = await tx
      .update(protocols)
      .set({ ...input, version: existing.version + 1, updatedAt: new Date() })
      .where(eq(protocols.id, protocolId))
      .returning();
    return assertDefined(updated, "protocol update returned no row");
  });
}

/**
 * Soft-delete only — a protocol's history must stay inspectable for anything
 * that already cited it (PRD §5 traceability), so retrieval simply filters
 * `isActive` rather than the row being removable.
 */
export async function deactivateProtocol(scope: HospitalScope, protocolId: string) {
  return withHospitalScope(scope, async (tx) => {
    const [existing] = await tx
      .select()
      .from(protocols)
      .where(and(eq(protocols.id, protocolId), eq(protocols.hospitalId, scope.hospitalId)));
    if (!existing) throw new NotFoundError("Protocol not found");

    const [updated] = await tx
      .update(protocols)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(protocols.id, protocolId))
      .returning();
    return assertDefined(updated, "protocol update returned no row");
  });
}
