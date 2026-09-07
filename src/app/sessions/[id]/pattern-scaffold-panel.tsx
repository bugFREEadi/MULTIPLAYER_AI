"use client";

type SessionEvent = {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
};

type ScaffoldPayload = {
  pattern_id?: string;
  pattern_name?: string;
  steps?: Array<{
    label?: string | null;
    agent_id?: string | null;
    role?: string | null;
    checkpoint_policy_id?: string | null;
  }>;
  agent_id?: string | null;
  attached_checkpoint_policy_ids?: string[];
};

export function PatternScaffoldPanel({
  events,
}: {
  events: SessionEvent[];
}) {
  const scaffold = [...events]
    .reverse()
    .find((e) => e.eventType === "pattern_scaffold");
  if (!scaffold) return null;
  const p = scaffold.payload as ScaffoldPayload;

  return (
    <section
      data-testid="pattern-scaffold-panel"
      className="mb-3 rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2"
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
        Pattern scaffold
      </h2>
      <p className="mt-1 text-xs text-emerald-800/80">
        Spun from pattern
        {p.pattern_name ? ` “${p.pattern_name}”` : ""}
        {p.agent_id ? ` · bound agent ${p.agent_id.slice(0, 8)}…` : ""}
      </p>
      <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm text-emerald-950">
        {(p.steps ?? []).map((step, i) => (
          <li key={i}>
            {step.label ? `${step.label}: ` : ""}
            {step.agent_id
              ? `agent ${step.agent_id.slice(0, 8)}…`
              : step.role
                ? `role ${step.role}`
                : "step"}
            {step.checkpoint_policy_id
              ? ` · checkpoint ${step.checkpoint_policy_id.slice(0, 8)}…`
              : " · no checkpoint"}
          </li>
        ))}
      </ol>
    </section>
  );
}
