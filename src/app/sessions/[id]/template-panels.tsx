"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  deriveTemplateFields,
  getSessionTemplate,
  type SessionTemplateId,
} from "@/lib/session-templates";

type SessionEvent = {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
};

type Props = {
  sessionId: string;
  templateId: SessionTemplateId;
  events: SessionEvent[];
  canEdit: boolean;
  onEventsChanged: () => Promise<void>;
};

export function TemplateStructuredPanels({
  sessionId,
  templateId,
  events,
  canEdit,
  onEventsChanged,
}: Props) {
  const def = getSessionTemplate(templateId);
  const fields = useMemo(
    () => deriveTemplateFields(templateId, events),
    [templateId, events]
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [optionTitle, setOptionTitle] = useState("");
  const [optionNotes, setOptionNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!def) return null;

  async function postUpdate(body: {
    field: string;
    action: string;
    value: unknown;
  }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/template-updates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? `Update failed (${res.status})`);
      }
      await onEventsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function onAddString(e: FormEvent, field: string) {
    e.preventDefault();
    const value = (drafts[field] ?? "").trim();
    if (!value || busy) return;
    setDrafts((prev) => ({ ...prev, [field]: "" }));
    await postUpdate({ field, action: "add", value });
  }

  async function onAddChecklist(e: FormEvent) {
    e.preventDefault();
    const text = (drafts.mitigation_checklist ?? "").trim();
    if (!text || busy) return;
    setDrafts((prev) => ({ ...prev, mitigation_checklist: "" }));
    await postUpdate({
      field: "mitigation_checklist",
      action: "add_item",
      value: { id: `m_${Date.now()}`, text, done: false },
    });
  }

  async function onAddOption(e: FormEvent) {
    e.preventDefault();
    const title = optionTitle.trim();
    if (!title || busy) return;
    const id = `o_${Date.now()}`;
    setOptionTitle("");
    setOptionNotes("");
    await postUpdate({
      field: "decision_options",
      action: "add_item",
      value: { id, title, notes: optionNotes.trim() },
    });
  }

  return (
    <section
      data-testid={`template-panels-${templateId}`}
      className="mb-3 space-y-3 rounded-md border border-indigo-200 bg-indigo-50/60 px-3 py-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-indigo-900">
          {def.label} panels
        </h2>
        <span className="text-[10px] uppercase tracking-wide text-indigo-700">
          {templateId}
        </span>
      </div>

      {error ? (
        <p className="text-xs text-red-700">{error}</p>
      ) : null}

      {def.panels.map((panel) => {
        if (panel.kind === "string_list") {
          const items = Array.isArray(fields[panel.id])
            ? (fields[panel.id] as string[])
            : [];
          return (
            <div
              key={panel.id}
              data-testid={`panel-${panel.id}`}
              className="rounded-md border border-indigo-100 bg-white px-3 py-2"
            >
              <p className="text-xs font-medium text-indigo-950">{panel.label}</p>
              {items.length === 0 ? (
                <p className="mt-1 text-xs text-neutral-500">None yet.</p>
              ) : (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-neutral-800">
                  {items.map((item) => (
                    <li key={item} className="flex items-center justify-between gap-2">
                      <span>{item}</span>
                      {canEdit ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void postUpdate({
                              field: panel.id,
                              action: "remove",
                              value: item,
                            })
                          }
                          className="text-[10px] uppercase text-neutral-400 hover:text-rose-700"
                        >
                          Remove
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit ? (
                <form
                  onSubmit={(e) => void onAddString(e, panel.id)}
                  className="mt-2 flex gap-2"
                >
                  <input
                    value={drafts[panel.id] ?? ""}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [panel.id]: e.target.value,
                      }))
                    }
                    placeholder={`Add ${panel.label.toLowerCase()}…`}
                    className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-xs"
                  />
                  <button
                    type="submit"
                    disabled={busy || !(drafts[panel.id] ?? "").trim()}
                    className="rounded bg-indigo-900 px-2 py-1 text-xs text-white disabled:opacity-50"
                  >
                    Add
                  </button>
                </form>
              ) : null}
            </div>
          );
        }

        if (panel.kind === "checklist") {
          const items = Array.isArray(fields[panel.id])
            ? (fields[panel.id] as Array<{
                id: string;
                text: string;
                done: boolean;
              }>)
            : [];
          return (
            <div
              key={panel.id}
              data-testid={`panel-${panel.id}`}
              className="rounded-md border border-indigo-100 bg-white px-3 py-2"
            >
              <p className="text-xs font-medium text-indigo-950">{panel.label}</p>
              {items.length === 0 ? (
                <p className="mt-1 text-xs text-neutral-500">None yet.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-sm">
                  {items.map((item) => (
                    <li key={item.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(item.done)}
                        disabled={!canEdit || busy}
                        onChange={() =>
                          void postUpdate({
                            field: panel.id,
                            action: "toggle_done",
                            value: item.id,
                          })
                        }
                      />
                      <span
                        className={
                          item.done ? "text-neutral-400 line-through" : ""
                        }
                      >
                        {item.text}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {canEdit ? (
                <form
                  onSubmit={(e) => void onAddChecklist(e)}
                  className="mt-2 flex gap-2"
                >
                  <input
                    value={drafts.mitigation_checklist ?? ""}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        mitigation_checklist: e.target.value,
                      }))
                    }
                    placeholder="Add mitigation…"
                    className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-xs"
                  />
                  <button
                    type="submit"
                    disabled={
                      busy || !(drafts.mitigation_checklist ?? "").trim()
                    }
                    className="rounded bg-indigo-900 px-2 py-1 text-xs text-white disabled:opacity-50"
                  >
                    Add
                  </button>
                </form>
              ) : null}
            </div>
          );
        }

        if (panel.kind === "option_list") {
          const items = Array.isArray(fields[panel.id])
            ? (fields[panel.id] as Array<{
                id: string;
                title: string;
                notes: string;
              }>)
            : [];
          const recommended =
            typeof fields.recommended_option_id === "string"
              ? fields.recommended_option_id
              : null;
          return (
            <div
              key={panel.id}
              data-testid={`panel-${panel.id}`}
              className="rounded-md border border-indigo-100 bg-white px-3 py-2"
            >
              <p className="text-xs font-medium text-indigo-950">{panel.label}</p>
              {items.length === 0 ? (
                <p className="mt-1 text-xs text-neutral-500">None yet.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className={`rounded border px-2 py-1.5 text-sm ${
                        recommended === item.id
                          ? "border-emerald-400 bg-emerald-50"
                          : "border-neutral-200"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">{item.title}</p>
                        {canEdit ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void postUpdate({
                                field: "recommended_option_id",
                                action: "set",
                                value: item.id,
                              })
                            }
                            className="text-[10px] uppercase text-emerald-800 underline"
                          >
                            {recommended === item.id ? "Recommended" : "Recommend"}
                          </button>
                        ) : recommended === item.id ? (
                          <span className="text-[10px] uppercase text-emerald-800">
                            Recommended
                          </span>
                        ) : null}
                      </div>
                      {item.notes ? (
                        <p className="mt-0.5 text-xs text-neutral-600">
                          {item.notes}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit ? (
                <form onSubmit={(e) => void onAddOption(e)} className="mt-2 space-y-1">
                  <input
                    value={optionTitle}
                    onChange={(e) => setOptionTitle(e.target.value)}
                    placeholder="Option title…"
                    className="w-full rounded border border-neutral-300 px-2 py-1 text-xs"
                  />
                  <input
                    value={optionNotes}
                    onChange={(e) => setOptionNotes(e.target.value)}
                    placeholder="Notes (optional)…"
                    className="w-full rounded border border-neutral-300 px-2 py-1 text-xs"
                  />
                  <button
                    type="submit"
                    disabled={busy || !optionTitle.trim()}
                    className="rounded bg-indigo-900 px-2 py-1 text-xs text-white disabled:opacity-50"
                  >
                    Add option
                  </button>
                </form>
              ) : null}
            </div>
          );
        }

        return null;
      })}
    </section>
  );
}
