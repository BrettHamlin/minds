// minds-events.ts — Minds-specific bus event types and message interface (BRE-444)
//
// Channel convention: `minds-{ticketId}` (separate from collab's `pipeline-{ticketId}`)

export enum MindsEventType {
  WAVE_STARTED = "WAVE_STARTED",
  WAVE_COMPLETE = "WAVE_COMPLETE",
  DRONE_SPAWNED = "DRONE_SPAWNED",
  DRONE_COMPLETE = "DRONE_COMPLETE",
  DRONE_REVIEWING = "DRONE_REVIEWING",
  DRONE_REVIEW_PASS = "DRONE_REVIEW_PASS",
  DRONE_REVIEW_FAIL = "DRONE_REVIEW_FAIL",
  DRONE_MERGING = "DRONE_MERGING",
  DRONE_MERGED = "DRONE_MERGED",
  CONTRACT_FULFILLED = "CONTRACT_FULFILLED",
}

export interface MindsBusMessage {
  /** Channel this message was published on (e.g. `minds-BRE-444`) */
  channel: string;
  /** Agent identifier that sent this message (e.g. `@transport`) */
  from: string;
  /** Event type */
  type: MindsEventType;
  /** Arbitrary event payload */
  payload: unknown;
  /** Ticket ID associated with this message (e.g. `BRE-444`) */
  ticketId: string;
  /** Mind name that produced this message (e.g. `transport`) */
  mindName: string;
}
