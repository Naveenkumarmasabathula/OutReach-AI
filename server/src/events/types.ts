/**
 * PRD §18's "important events" list. Payloads are an open jsonb bag rather
 * than a fully-typed-per-event-name union — every payload always includes
 * enough to re-fetch the affected resource (its id), and a strict per-type
 * schema for 15 event shapes would be a lot of ceremony for a system where
 * only one event type (escalation.created) has a real consumer today. See
 * docs/workflows-events.md for which events actually drive a workflow vs.
 * which are published for audit/observability only.
 */
export const EVENT_TYPES = [
  "campaign.created",
  "campaign.ready",
  "campaign.started",
  "campaign.paused",
  "campaign.resumed",
  "campaign.cancelled",
  "campaign.completed",
  "task.completed",
  "task.failed",
  "task.escalated",
  "task.manual_follow_up",
  "retry.scheduled",
  "callback.requested",
  "escalation.created",
  "escalation.acknowledged",
  "escalation.resolved",
] as const;

export type AppEventType = (typeof EVENT_TYPES)[number];
