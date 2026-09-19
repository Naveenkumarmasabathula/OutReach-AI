import { createPatientSchema } from "../../src/services/patientService.js";

/**
 * A patient whose stated preferred contact method has no matching value on
 * file (email preferred but no email given, or phone/SMS preferred but no
 * phone given) is a patient the outreach queue can never actually reach —
 * found as a real bug: the create-patient form offered "Email" as a
 * selectable preference with no field to actually enter one. Enforced here
 * at the schema level (not just the frontend form) since the API can be
 * called directly.
 */
describe("createPatientSchema: preferred contact method must have a matching value on file", () => {
  const base = { mrn: "TEST-1", firstName: "Test", lastName: "Patient" };

  it("rejects preferredContactMethod 'email' with no email address", () => {
    const result = createPatientSchema.safeParse({ ...base, preferredContactMethod: "email" });
    expect(result.success).toBe(false);
  });

  it("accepts preferredContactMethod 'email' when an email address is provided", () => {
    const result = createPatientSchema.safeParse({
      ...base,
      preferredContactMethod: "email",
      email: "patient@example.dev",
    });
    expect(result.success).toBe(true);
  });

  it("rejects preferredContactMethod 'phone' with no phone number", () => {
    const result = createPatientSchema.safeParse({ ...base, preferredContactMethod: "phone" });
    expect(result.success).toBe(false);
  });

  it("rejects preferredContactMethod 'sms' with no phone number", () => {
    const result = createPatientSchema.safeParse({ ...base, preferredContactMethod: "sms" });
    expect(result.success).toBe(false);
  });

  it("accepts preferredContactMethod 'phone' when a phone number is provided", () => {
    const result = createPatientSchema.safeParse({ ...base, preferredContactMethod: "phone", phone: "+15551234567" });
    expect(result.success).toBe(true);
  });
});
