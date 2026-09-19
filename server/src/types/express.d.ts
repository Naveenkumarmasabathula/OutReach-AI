import type { Role } from "../config/roles.js";
import type { HospitalScope } from "../db/scope.js";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        hospitalId: string | null;
        role: Role;
      };
      /**
       * Only present once an access guard has resolved and verified hospital
       * access for this request. Route handlers/services must use this, never
       * `req.user.hospitalId` or a route param, to scope hospital-tenant data.
       */
      hospitalScope?: HospitalScope;
    }
  }
}

export {};
