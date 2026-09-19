import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../lib/errors.js";
import { verifyAuthToken } from "../lib/jwt.js";

/**
 * Verifies the JWT and attaches `req.user`. This is the ONLY place hospital
 * identity enters a request — every downstream guard/service reads
 * `req.user.hospitalId`, never a request param/body/query value, per
 * docs/multi-tenancy.md §1.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing bearer token");
  }

  const token = header.slice("Bearer ".length);
  try {
    const payload = verifyAuthToken(token);
    req.user = { id: payload.sub, hospitalId: payload.hospitalId, role: payload.role };
    next();
  } catch {
    throw new UnauthorizedError("Invalid or expired token");
  }
}
