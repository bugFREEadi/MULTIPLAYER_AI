/**
 * Session template registry — Feature 1.10 / Step 15.
 * Plain config object (not a DB table). Safe for client + server imports.
 */

export const SESSION_TEMPLATE_IDS = [
  "incident_response",
  "architecture_decision",
] as const;

export type SessionTemplateId = (typeof SESSION_TEMPLATE_IDS)[number];

export type SessionTemplateDefinition = {
  id: SessionTemplateId;
  label: string;
  description: string;
  defaultTitle: string;
  /** Structured panels layered on the shared event timeline. */
  panels: Array<{
    id: string;
    label: string;
    kind: "string_list" | "checklist" | "option_list";
  }>;
  initialFields: Record<string, unknown>;
};

export const SESSION_TEMPLATES: Record<
  SessionTemplateId,
  SessionTemplateDefinition
> = {
  incident_response: {
    id: "incident_response",
    label: "Incident response",
    description:
      "Coordinate an outage or incident with impacted services and mitigations.",
    defaultTitle: "Incident",
    panels: [
      { id: "impacted_services", label: "Impacted services", kind: "string_list" },
      {
        id: "mitigation_checklist",
        label: "Mitigation checklist",
        kind: "checklist",
      },
    ],
    initialFields: {
      impacted_services: [] as string[],
      mitigation_checklist: [] as Array<{
        id: string;
        text: string;
        done: boolean;
      }>,
      severity: null as string | null,
    },
  },
  architecture_decision: {
    id: "architecture_decision",
    label: "Architecture decision",
    description:
      "Compare options against constraints and capture a recommendation.",
    defaultTitle: "Architecture decision",
    panels: [
      { id: "decision_options", label: "Decision options", kind: "option_list" },
      { id: "constraints", label: "Constraints", kind: "string_list" },
    ],
    initialFields: {
      decision_options: [] as Array<{
        id: string;
        title: string;
        notes: string;
      }>,
      constraints: [] as string[],
      recommended_option_id: null as string | null,
    },
  },
};

export function isSessionTemplateId(value: unknown): value is SessionTemplateId {
  return (
    typeof value === "string" &&
    (SESSION_TEMPLATE_IDS as readonly string[]).includes(value)
  );
}

export function getSessionTemplate(
  id: string | null | undefined
): SessionTemplateDefinition | null {
  if (!id || !isSessionTemplateId(id)) return null;
  return SESSION_TEMPLATES[id];
}

export function listSessionTemplates(): SessionTemplateDefinition[] {
  return SESSION_TEMPLATE_IDS.map((id) => SESSION_TEMPLATES[id]);
}

/** Fold template_state + template_update events into current structured fields. */
export function deriveTemplateFields(
  templateId: SessionTemplateId,
  events: Array<{ eventType: string; payload: Record<string, unknown> }>
): Record<string, unknown> {
  const def = SESSION_TEMPLATES[templateId];
  let fields: Record<string, unknown> = structuredClone(def.initialFields);

  for (const event of events) {
    if (event.eventType === "template_state") {
      const next = event.payload.fields;
      if (next && typeof next === "object" && !Array.isArray(next)) {
        fields = { ...fields, ...(next as Record<string, unknown>) };
      }
      continue;
    }
    if (event.eventType !== "template_update") continue;

    const field = event.payload.field;
    if (typeof field !== "string") continue;
    const action = event.payload.action;
    const value = event.payload.value;

    if (action === "set") {
      fields[field] = value;
      continue;
    }

    if (action === "add" && typeof value === "string") {
      const list = Array.isArray(fields[field])
        ? [...(fields[field] as unknown[])]
        : [];
      list.push(value);
      fields[field] = list;
      continue;
    }

    if (action === "add_item" && value && typeof value === "object") {
      const list = Array.isArray(fields[field])
        ? [...(fields[field] as unknown[])]
        : [];
      list.push(value);
      fields[field] = list;
      continue;
    }

    if (action === "remove" && typeof value === "string") {
      const list = Array.isArray(fields[field])
        ? [...(fields[field] as unknown[])]
        : [];
      fields[field] = list.filter((item) => {
        if (typeof item === "string") return item !== value;
        if (item && typeof item === "object" && "id" in item) {
          return (item as { id: unknown }).id !== value;
        }
        if (item && typeof item === "object" && "text" in item) {
          return (item as { text: unknown }).text !== value;
        }
        return true;
      });
      continue;
    }

    if (action === "toggle_done" && typeof value === "string") {
      const list = Array.isArray(fields[field])
        ? [...(fields[field] as Array<Record<string, unknown>>)]
        : [];
      fields[field] = list.map((item) =>
        item && item.id === value ? { ...item, done: !item.done } : item
      );
    }
  }

  return fields;
}
