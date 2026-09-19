import type { NextFunction, Request, Response } from "express";
import { type Permission, roleHasPermission } from "../config/roles.js";
import { mintHospitalScope } from "../db/scope.js";
import { ForbiddenError, UnauthorizedError } from "../lib/errors.js";
import { requireParam } from "../lib/params.js";

/**
 * For routes operated by a hospital-scoped role (HOSPITAL_ADMIN,
 * CAMPAIGN_MANAGER, CLINICAL_REVIEWER) acting on their own hospital. Mints the
 * HospitalScope from the authenticated principal only — never from a request
 * param. PLATFORM_ADMIN has no single hospital and is rejected here; it uses
 * `requirePlatformHospitalAccess` on the separate platform-management routes.
 */
export function requireHospitalAccess() {
  return function requireHospitalAccessMiddleware(req: Request, _res: Response, next: NextFunction) {
    if (!req.user) throw new UnauthorizedError();
    if (!req.user.hospitalId) {
      throw new ForbiddenError("This action requires a hospital-scoped role");
    }
    req.hospitalScope = mintHospitalScope(req.user.hospitalId);
    next();
  };
}

/**
 * For PLATFORM_ADMIN routes that target a specific hospital by id (e.g.
 * managing hospital config/onboarding). Resolves and mints the HospitalScope
 * for the *target* hospital from the route param BEFORE any permission check
 * runs — this is the "hospital scope before capability" ordering from
 * docs/multi-tenancy.md §1 (the reference project's Invariant I15 fix): a
 * platform-wide role must never be treated as an implicit bypass of the scope
 * resolution step itself.
 */
export function requirePlatformHospitalAccess(paramName = "hospitalId") {
  return function requirePlatformHospitalAccessMiddleware(req: Request, _res: Response, next: NextFunction) {
    if (!req.user) throw new UnauthorizedError();
    if (req.user.role !== "PLATFORM_ADMIN") {
      throw new ForbiddenError("Platform admin role required");
    }
    const targetHospitalId = requireParam(req, paramName);
    req.hospitalScope = mintHospitalScope(targetHospitalId);
    next();
  };
}

/** Checks the authenticated principal's role grants `permission`. */
export function requirePermission(permission: Permission) {
  return function requirePermissionMiddleware(req: Request, _res: Response, next: NextFunction) {
    if (!req.user) throw new UnauthorizedError();
    if (!roleHasPermission(req.user.role, permission)) {
      throw new ForbiddenError(`Missing permission: ${permission}`);
    }
    next();
  };
}
