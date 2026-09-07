import { appendSessionEvent } from "@/lib/events";
import {
  SESSION_TEMPLATES,
  type SessionTemplateId,
} from "@/lib/session-templates";

/** Seed the structured first event when a templated session is created. */
export async function seedTemplateStateEvent(opts: {
  sessionId: string;
  actorId: string;
  templateId: SessionTemplateId;
}) {
  const def = SESSION_TEMPLATES[opts.templateId];
  return appendSessionEvent({
    sessionId: opts.sessionId,
    eventType: "template_state",
    actorId: opts.actorId,
    actorType: "human",
    payload: {
      template: opts.templateId,
      fields: structuredClone(def.initialFields),
    },
  });
}
