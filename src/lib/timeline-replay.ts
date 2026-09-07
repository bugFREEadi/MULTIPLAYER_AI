/**
 * Pure helpers for Step 16 timeline replay (Feature 1.6 / 1.7).
 * Reconstruct display state as events with sequence_number ≤ N.
 */

export type TimelineEventLike = {
  id: string;
  sequenceNumber: number;
  eventType: string;
  payload: Record<string, unknown>;
};

export function eventsThrough<T extends TimelineEventLike>(
  events: T[],
  throughSequence: number | null
): T[] {
  if (throughSequence == null) return events;
  return events.filter((e) => e.sequenceNumber <= throughSequence);
}

export function resolvedSuggestionIds(
  events: TimelineEventLike[]
): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    if (
      event.eventType === "suggestion_accepted" ||
      event.eventType === "suggestion_dismissed"
    ) {
      const id = event.payload.suggestion_event_id;
      if (typeof id === "string") ids.add(id);
    }
    if (event.eventType === "user_message") {
      const from = event.payload.from_suggestion_id;
      if (typeof from === "string") ids.add(from);
    }
  }
  return ids;
}

export function resolvedCheckpointIds(
  events: TimelineEventLike[]
): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.eventType === "checkpoint_resolved") {
      const id = event.payload.checkpoint_event_id;
      if (typeof id === "string") ids.add(id);
    }
  }
  return ids;
}

/** Same visibility rules as the live session timeline (Step 6/8 rendering). */
export function filterVisibleTimelineEvents<T extends TimelineEventLike>(
  events: T[]
): T[] {
  const suggestionResolved = resolvedSuggestionIds(events);
  const checkpointResolved = resolvedCheckpointIds(events);
  return events.filter((event) => {
    if (
      event.eventType === "suggestion_accepted" ||
      event.eventType === "suggestion_dismissed" ||
      event.eventType === "checkpoint_resolved" ||
      event.eventType === "template_state" ||
      event.eventType === "template_update" ||
      event.eventType === "related_context" ||
      event.eventType === "pattern_scaffold" ||
      event.eventType === "playbook_extracted"
    ) {
      return false;
    }
    if (
      event.eventType === "suggestion" &&
      suggestionResolved.has(event.id)
    ) {
      return false;
    }
    if (
      event.eventType === "checkpoint_raised" &&
      checkpointResolved.has(event.id)
    ) {
      return false;
    }
    return true;
  });
}
