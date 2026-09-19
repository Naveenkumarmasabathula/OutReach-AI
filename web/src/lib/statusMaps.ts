import type { BadgeVariant } from "../components/ui/Badge.js";

export function hospitalStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case "active":
      return "good";
    case "suspended":
      return "critical";
    default:
      return "neutral"; // draft
  }
}

export function riskLevelVariant(level: number): BadgeVariant {
  if (level >= 4) return "critical";
  if (level === 3) return "warning";
  return "good";
}

export function encounterStatusVariant(status: string): BadgeVariant {
  return status === "discharged" ? "good" : "info";
}

export function campaignStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case "running":
      return "good";
    case "paused":
      return "warning";
    case "cancelled":
    case "failed":
      return "critical";
    case "completed":
      return "neutral";
    case "ready":
    case "scheduled":
      return "info";
    default:
      return "neutral"; // draft
  }
}

export function queueTaskStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case "completed":
      return "good";
    case "calling":
      return "info";
    case "escalated":
    case "failed":
      return "critical";
    case "manual_follow_up":
      return "warning";
    case "retry_scheduled":
    case "callback_scheduled":
    case "scheduled":
      return "info";
    case "cancelled":
      return "neutral";
    default:
      return "neutral"; // pending
  }
}

export function escalationStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case "open":
      return "critical";
    case "assigned":
    case "in_review":
      return "warning";
    case "waiting_for_information":
      return "info";
    case "resolved":
    case "closed":
      return "good";
    default:
      return "neutral";
  }
}

// Groups the outreach-task state machine into scan-friendly buckets for the
// Queue card — many tasks sit in parallel states at once, so a stepper
// doesn't fit (see LifecycleTimeline's own doc comment); grouping by what
// each state actually means operationally ("mid-call," "waiting for its
// turn," "needs a human," "done") reads faster than a flat, arbitrarily
// ordered badge list.
export const QUEUE_STATUS_GROUPS: Array<{ key: string; label: string; statuses: string[] }> = [
  { key: "active", label: "In progress", statuses: ["calling"] },
  { key: "waiting", label: "Waiting", statuses: ["pending", "scheduled", "retry_scheduled", "callback_scheduled"] },
  { key: "attention", label: "Needs attention", statuses: ["escalated", "manual_follow_up"] },
  { key: "done", label: "Done", statuses: ["completed", "cancelled", "failed"] },
];

export function escalationPriorityVariant(priority: number): BadgeVariant {
  if (priority <= 1) return "critical";
  if (priority === 2) return "warning";
  return "neutral";
}

const PROTOCOL_CATEGORY_LABELS: Record<string, string> = {
  follow_up_questions: "Follow-up questions",
  red_flag_indicator: "Red-flag indicator",
  specialty_instruction: "Specialty instruction",
  patient_guidance: "Patient guidance",
  escalation_contact: "Escalation contact",
  operational_rule: "Operational rule",
};

export function protocolCategoryLabel(category: string): string {
  return PROTOCOL_CATEGORY_LABELS[category] ?? category;
}

const CONTACT_METHOD_LABELS: Record<string, string> = {
  phone: "Phone",
  sms: "SMS",
  email: "Email",
};

export function contactMethodLabel(method: string): string {
  return CONTACT_METHOD_LABELS[method] ?? method;
}
