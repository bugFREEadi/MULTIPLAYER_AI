"use client";

type ScrubEvent = {
  id: string;
  sequenceNumber: number;
  eventType: string;
};

function markerClass(eventType: string): string {
  switch (eventType) {
    case "user_message":
      return "bg-neutral-900";
    case "agent_message":
    case "agent_tool_call":
      return "bg-neutral-400";
    case "checkpoint_raised":
      return "bg-rose-500";
    case "checkpoint_resolved":
      return "bg-rose-300";
    case "handoff_brief":
      return "bg-sky-500";
    case "suggestion":
      return "bg-amber-400";
    case "template_state":
    case "template_update":
      return "bg-indigo-400";
    case "role_change":
      return "bg-emerald-500";
    default:
      return "bg-neutral-300";
  }
}

function shortLabel(eventType: string): string {
  switch (eventType) {
    case "user_message":
      return "user";
    case "agent_message":
      return "agent";
    case "agent_tool_call":
      return "tool";
    case "checkpoint_raised":
      return "cp↑";
    case "checkpoint_resolved":
      return "cp✓";
    case "handoff_brief":
      return "handoff";
    case "suggestion":
      return "suggest";
    case "template_state":
      return "tmpl";
    case "template_update":
      return "tmpl↑";
    case "role_change":
      return "role";
    default:
      return eventType.slice(0, 6);
  }
}

type Props = {
  events: ScrubEvent[];
  /** null = live (at latest) */
  throughSequence: number | null;
  onScrub: (sequenceNumber: number) => void;
  onReturnLive: () => void;
};

/**
 * Timeline scrubber — Feature 1.6 / 1.7 (Step 16).
 * Click a marker to reconstruct session state for events 0..N.
 */
export default function TimelineScrubber({
  events,
  throughSequence,
  onScrub,
  onReturnLive,
}: Props) {
  const liveSeq =
    events.length > 0 ? events[events.length - 1].sequenceNumber : 0;
  const isLive = throughSequence == null || throughSequence >= liveSeq;
  const activeSeq = isLive ? liveSeq : throughSequence;

  if (events.length === 0) {
    return (
      <section
        data-testid="timeline-scrubber"
        className="mb-3 rounded-md border border-dashed border-neutral-300 px-3 py-2 text-xs text-neutral-500"
      >
        Timeline empty — events appear here as the session progresses.
      </section>
    );
  }

  return (
    <section
      data-testid="timeline-scrubber"
      className="mb-3 rounded-md border border-neutral-200 bg-white px-3 py-2"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Timeline
        </h2>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-neutral-500">
            {isLive ? `live · #${liveSeq}` : `as of #${activeSeq} / #${liveSeq}`}
          </span>
          {!isLive ? (
            <button
              type="button"
              data-testid="return-to-live"
              onClick={onReturnLive}
              className="rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-700 hover:bg-neutral-50"
            >
              Return to live
            </button>
          ) : null}
        </div>
      </div>

      <div className="relative">
        <div className="absolute top-1/2 right-0 left-0 h-px -translate-y-1/2 bg-neutral-200" />
        <ol className="relative flex flex-wrap items-center gap-1.5">
          {events.map((event) => {
            const selected = event.sequenceNumber === activeSeq;
            const past =
              activeSeq != null && event.sequenceNumber <= activeSeq;
            return (
              <li key={event.id}>
                <button
                  type="button"
                  data-testid={`scrub-${event.sequenceNumber}`}
                  title={`#${event.sequenceNumber} ${event.eventType}`}
                  aria-label={`Jump to event ${event.sequenceNumber} (${event.eventType})`}
                  aria-pressed={selected}
                  onClick={() => onScrub(event.sequenceNumber)}
                  className={`group relative flex h-7 min-w-7 flex-col items-center justify-center rounded-md border px-1.5 transition ${
                    selected
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : past
                        ? "border-neutral-300 bg-neutral-50 text-neutral-700 hover:border-neutral-500"
                        : "border-neutral-200 bg-white text-neutral-400 hover:border-neutral-400"
                  }`}
                >
                  <span
                    className={`mb-0.5 h-1.5 w-1.5 rounded-full ${
                      selected ? "bg-white" : markerClass(event.eventType)
                    }`}
                  />
                  <span className="text-[9px] leading-none font-medium">
                    {event.sequenceNumber}
                  </span>
                  <span className="pointer-events-none absolute -bottom-5 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-neutral-900 px-1.5 py-0.5 text-[9px] text-white group-hover:block">
                    {shortLabel(event.eventType)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {!isLive ? (
        <p
          data-testid="replay-banner"
          className="mt-3 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs text-indigo-950"
        >
          Viewing session as of event #{activeSeq} —{" "}
          <button
            type="button"
            onClick={onReturnLive}
            className="font-medium underline"
          >
            Return to live
          </button>
          . New live events still arrive in the background.
        </p>
      ) : null}
    </section>
  );
}
