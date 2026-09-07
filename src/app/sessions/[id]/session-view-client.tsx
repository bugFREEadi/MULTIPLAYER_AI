"use client";

import { useCompletion } from "@ai-sdk/react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { flushSync } from "react-dom";
import { useSessionLiveChannel } from "@/hooks/use-session-live";
import type { LiveSessionEventPayload } from "@/lib/realtime-types";
import type { SessionTemplateId } from "@/lib/session-templates";
import {
  eventsThrough,
  filterVisibleTimelineEvents,
  resolvedCheckpointIds as resolvedCheckpointIdsFromEvents,
} from "@/lib/timeline-replay";
import { TemplateStructuredPanels } from "./template-panels";
import { RelatedContextPanel } from "./related-context-panel";
import { PatternScaffoldPanel } from "./pattern-scaffold-panel";
import TimelineScrubber from "./timeline-scrubber";

type SessionEvent = {
  id: string;
  sequenceNumber: number;
  eventType: string;
  actorType: string;
  actorId?: string | null;
  sessionId?: string | null;
  payload: Record<string, unknown>;
  createdAt: string | null;
  costUsd?: string | null;
  tokenUsage?: Record<string, unknown> | null;
};

type SessionDetail = {
  id: string;
  title: string | null;
  status: string;
  visibility?: string | null;
  sessionTemplate?: string | null;
  parentSessionId?: string | null;
  forkedFromEventSeq?: number | null;
};

type Membership = {
  role: string;
  userId?: string;
};

type Permissions = {
  canWriteUserMessage: boolean;
  canPostSuggestion: boolean;
  canResolveSuggestion: boolean;
  canManageMembers: boolean;
  canTakeControl: boolean;
  canRaiseManualCheckpoint?: boolean;
  canBranch?: boolean;
  canMerge?: boolean;
  canGenerateHandoff?: boolean;
};

type PendingDecision = {
  id: string;
  sequenceNumber: number;
  policyName: string;
  requiredRole: string | null;
  reason: string | null;
  createdAt: string | null;
};

type BranchSummary = {
  id: string;
  title: string | null;
  forkedFromEventSeq: number | null;
  status: string;
};

type SessionMember = {
  userId: string;
  role: string;
  name: string | null;
  email: string | null;
};

type RecalledMemoryFact = {
  id: string;
  fact: string;
  scope: string;
  sourceSessionId: string | null;
  sourceEventSeq: number | null;
  sourceSessionTitle: string | null;
  distance: number;
  score: number;
};

function eventContent(event: SessionEvent): string {
  const payload = event.payload;
  if (payload && typeof payload.content === "string") {
    return payload.content;
  }
  if (event.eventType === "handoff_brief") {
    if (typeof payload.summary === "string") return payload.summary;
  }
  if (event.eventType === "agent_tool_call") {
    const tool =
      typeof payload.tool_name === "string" ? payload.tool_name : "tool";
    return `[tool_call] ${tool}`;
  }
  if (event.eventType === "role_change") {
    return "Pilot control transferred";
  }
  return JSON.stringify(payload);
}

function isUserSide(event: SessionEvent) {
  if (
    event.eventType === "role_change" ||
    event.eventType === "suggestion" ||
    event.eventType === "handoff_brief" ||
    event.eventType === "checkpoint_raised"
  ) {
    return false;
  }
  return event.eventType === "user_message" || event.actorType === "human";
}

function mergeEvents(prev: SessionEvent[], incoming: SessionEvent[]): SessionEvent[] {
  const byId = new Map(prev.map((e) => [e.id, e]));
  for (const event of incoming) {
    byId.set(event.id, event);
  }
  return [...byId.values()].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
}

function livePayloadToEvent(payload: LiveSessionEventPayload): SessionEvent {
  const e = payload.event;
  return {
    id: e.id,
    sequenceNumber: e.sequenceNumber,
    eventType: e.eventType,
    actorType: e.actorType,
    actorId: e.actorId,
    payload: e.payload,
    createdAt: e.createdAt,
    costUsd: e.costUsd ?? null,
    tokenUsage: e.tokenUsage ?? null,
  };
}

function sumEventCosts(events: SessionEvent[]): number {
  let total = 0;
  for (const event of events) {
    if (event.costUsd == null || event.costUsd === "") continue;
    const n = Number(event.costUsd);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

function formatUsd(amount: number): string {
  if (amount > 0 && amount < 0.01) return amount.toFixed(6);
  return amount.toFixed(4);
}

function resolvedCheckpointIds(events: SessionEvent[]): Set<string> {
  return resolvedCheckpointIdsFromEvents(events);
}

function pendingCheckpointsFromEvents(events: SessionEvent[]): PendingDecision[] {
  const resolved = resolvedCheckpointIds(events);
  return events
    .filter(
      (event) =>
        event.eventType === "checkpoint_raised" && !resolved.has(event.id)
    )
    .map((event) => {
      const payload = event.payload;
      return {
        id: event.id,
        sequenceNumber: event.sequenceNumber,
        policyName:
          typeof payload.policy_name === "string"
            ? payload.policy_name
            : "Checkpoint",
        requiredRole:
          typeof payload.required_role === "string"
            ? payload.required_role
            : null,
        reason: typeof payload.reason === "string" ? payload.reason : null,
        createdAt: event.createdAt,
      };
    });
}

function roleBadgeClass(role: string) {
  switch (role) {
    case "owner":
      return "bg-neutral-900 text-white";
    case "pilot":
      return "bg-emerald-800 text-white";
    case "co_pilot":
      return "bg-emerald-100 text-emerald-900";
    case "reviewer":
      return "bg-amber-100 text-amber-900";
    case "observer":
    case "auditor":
      return "bg-neutral-200 text-neutral-700";
    default:
      return "bg-neutral-100 text-neutral-600";
  }
}

function streamingFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  onRawChunk: (text: string, accumulated: string) => void
): Promise<Response> {
  return fetch(input, init).then((response) => {
    if (!response.body) {
      return response;
    }

    const [forLog, forHook] = response.body.tee();
    const decoder = new TextDecoder();
    let accumulated = "";
    let chunkIndex = 0;

    void (async () => {
      const reader = forLog.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          accumulated += text;
          chunkIndex += 1;
          console.log(
            "[mock-stream client raw]",
            new Date().toISOString(),
            `chunk=${chunkIndex}`,
            `len=${text.length}`,
            `total=${accumulated.length}`,
            JSON.stringify(text)
          );
          onRawChunk(text, accumulated);
        }
      } catch (err) {
        console.error("[mock-stream client raw] read error", err);
      }
    })();

    return new Response(forHook, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  });
}

export default function SessionViewClient({
  sessionId,
  expectedTemplate,
}: {
  sessionId: string;
  expectedTemplate?: SessionTemplateId;
}) {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [members, setMembers] = useState<SessionMember[]>([]);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveReady, setLiveReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [takingControl, setTakingControl] = useState(false);
  const [resolvingCheckpointId, setResolvingCheckpointId] = useState<
    string | null
  >(null);
  const [childBranches, setChildBranches] = useState<BranchSummary[]>([]);
  const [branchingSeq, setBranchingSeq] = useState<number | null>(null);
  const [pendingDecisions, setPendingDecisions] = useState<PendingDecision[]>(
    []
  );
  const [generatingHandoff, setGeneratingHandoff] = useState(false);
  const [memoryFacts, setMemoryFacts] = useState<RecalledMemoryFact[]>([]);
  const [extractingMemory, setExtractingMemory] = useState(false);
  const [taskGraph, setTaskGraph] = useState<{
    id: string;
    goal: string;
    status: string;
  } | null>(null);
  const [taskNodes, setTaskNodes] = useState<
    Array<{
      id: string;
      title: string;
      status: string;
      dependsOn: string[] | null;
      childSessionId: string | null;
      assignedToType: string;
    }>
  >([]);
  const [delegateGoal, setDelegateGoal] = useState("");
  const [delegating, setDelegating] = useState(false);
  const [completingNodeId, setCompletingNodeId] = useState<string | null>(null);
  const [guestInviteUrl, setGuestInviteUrl] = useState<string | null>(null);
  const [guestRole, setGuestRole] = useState<"observer" | "reviewer">(
    "observer"
  );
  const [invitingGuest, setInvitingGuest] = useState(false);
  const [guestOrgName, setGuestOrgName] = useState("");
  const [completingSession, setCompletingSession] = useState(false);
  const [extractingPlaybook, setExtractingPlaybook] = useState(false);
  const [extractedPatternId, setExtractedPatternId] = useState<string | null>(
    null
  );
  const canManageMembers = Boolean(permissions?.canManageMembers);
  /** null = live view; otherwise reconstruct state for events with seq ≤ N */
  const [replayThroughSeq, setReplayThroughSeq] = useState<number | null>(null);
  const streamTextRef = useRef("");
  const eventsRef = useRef<SessionEvent[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const completionLogRef = useRef("");

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  const canWrite = Boolean(permissions?.canWriteUserMessage);
  const canSuggest = Boolean(permissions?.canPostSuggestion);
  const canResolve = Boolean(permissions?.canResolveSuggestion);
  const canTakeControl = Boolean(permissions?.canTakeControl);
  const canBranch = Boolean(permissions?.canBranch);
  const canMerge = Boolean(permissions?.canMerge);
  const canGenerateHandoff = Boolean(permissions?.canGenerateHandoff);
  const sessionPaused = session?.status === "paused_checkpoint";
  const sessionCompleted = session?.status === "completed";
  const isReplaying = replayThroughSeq != null;
  const inputEnabled =
    (canWrite || canSuggest) &&
    !sessionPaused &&
    !sessionCompleted &&
    !isReplaying;

  const refreshMembership = useCallback(async () => {
    const detailRes = await fetch(`/api/sessions/${sessionId}`);
    const detailData = (await detailRes.json().catch(() => null)) as {
      session?: SessionDetail;
      membership?: Membership;
      permissions?: Permissions;
      members?: SessionMember[];
      error?: string;
    } | null;
    if (!detailRes.ok || !detailData?.session) {
      throw new Error(
        detailData?.error ?? `Failed to load session (${detailRes.status})`
      );
    }
    setSession(detailData.session);
    setMembership(detailData.membership ?? null);
    setPermissions(detailData.permissions ?? null);
    setMembers(detailData.members ?? []);

    const branchesRes = await fetch(`/api/sessions/${sessionId}/branches`);
    if (branchesRes.ok) {
      const branchesData = (await branchesRes.json()) as {
        branches?: BranchSummary[];
      };
      setChildBranches(branchesData.branches ?? []);
    }
  }, [sessionId]);

  const loadEvents = useCallback(
    async (since = 0) => {
      const url =
        since > 0
          ? `/api/sessions/${sessionId}/events?since=${since}`
          : `/api/sessions/${sessionId}/events`;
      const res = await fetch(url);
      const data = (await res.json().catch(() => null)) as {
        events?: SessionEvent[];
        error?: string;
      } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? `Failed to load events (${res.status})`);
      }
      const incoming = data?.events ?? [];
      if (since > 0) {
        setEvents((prev) => mergeEvents(prev, incoming));
      } else {
        setEvents(incoming);
      }
      return incoming;
    },
    [sessionId]
  );

  const loadPendingDecisions = useCallback(async () => {
    const res = await fetch(`/api/sessions/${sessionId}/pending-decisions`);
    const data = (await res.json().catch(() => null)) as {
      pendingCheckpoints?: PendingDecision[];
      error?: string;
    } | null;
    if (!res.ok) {
      throw new Error(
        data?.error ?? `Failed to load pending decisions (${res.status})`
      );
    }
    setPendingDecisions(data?.pendingCheckpoints ?? []);
  }, [sessionId]);

  const ingestLiveEvent = useCallback(
    async (payload: LiveSessionEventPayload) => {
      if (payload.session_id !== sessionId) return;
      const event = livePayloadToEvent(payload);
      const lastSeq = eventsRef.current.reduce(
        (max, e) => Math.max(max, e.sequenceNumber),
        0
      );

      if (event.sequenceNumber > lastSeq + 1) {
        try {
          await loadEvents(lastSeq);
        } catch (err) {
          console.error("[live] gap fill failed", err);
        }
      }

      setEvents((prev) => mergeEvents(prev, [event]));

      if (event.eventType === "user_message") {
        const content =
          typeof event.payload.content === "string" ? event.payload.content : null;
        setPendingUser((pending) =>
          pending && content && pending === content ? null : pending
        );
      }

      if (event.eventType === "role_change") {
        try {
          await refreshMembership();
        } catch (err) {
          console.error("[live] membership refresh failed", err);
        }
      }

      if (
        event.eventType === "checkpoint_raised" ||
        event.eventType === "checkpoint_resolved"
      ) {
        try {
          await refreshMembership();
          await loadPendingDecisions();
        } catch (err) {
          console.error("[live] checkpoint status refresh failed", err);
        }
      }
    },
    [loadEvents, loadPendingDecisions, refreshMembership, sessionId]
  );

  useSessionLiveChannel(sessionId, liveReady, (payload) => {
    void ingestLiveEvent(payload);
  });

  const {
    completion,
    complete,
    isLoading: isStreaming,
    setCompletion,
    error: completionError,
  } = useCompletion({
    api: `/api/sessions/${sessionId}/stream`,
    streamProtocol: "text",
    fetch: (input, init) =>
      streamingFetch(input, init, (_piece, accumulated) => {
        flushSync(() => {
          streamTextRef.current = accumulated;
          setStreamText(accumulated);
        });
      }),
    onFinish: async () => {
      try {
        const lastSeq = eventsRef.current.reduce(
          (max, e) => Math.max(max, e.sequenceNumber),
          0
        );
        await loadEvents(lastSeq);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to refresh events");
      } finally {
        setPendingUser(null);
        setCompletion("");
        setStreamText("");
        streamTextRef.current = "";
        completionLogRef.current = "";
        setResolvingId(null);
      }
    },
    onError: async (err) => {
      setPendingUser(null);
      setStreamText("");
      streamTextRef.current = "";
      setCompletion("");
      try {
        await loadEvents(0);
        await refreshMembership();
      } catch {
        /* ignore */
      }
      setError(err.message);
    },
  });

  useEffect(() => {
    if (completion === completionLogRef.current) return;
    completionLogRef.current = completion;
  }, [completion]);

  const loadAll = useCallback(async () => {
    setError(null);
    setLoading(true);
    setLiveReady(false);
    try {
      await refreshMembership();
      await loadEvents(0);
      await loadPendingDecisions();
      setLiveReady(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load session");
    } finally {
      setLoading(false);
    }
  }, [loadEvents, loadPendingDecisions, refreshMembership]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events, streamText, pendingUser]);

  useEffect(() => {
    if (completionError) {
      setError(completionError.message);
      setPendingUser(null);
      setResolvingId(null);
      // Stream may return 409 JSON when a keyword checkpoint pauses the turn.
      void loadEvents(0);
      void refreshMembership();
    }
  }, [completionError, loadEvents, refreshMembership]);

  const liveMaxSeq = useMemo(
    () => events.reduce((max, e) => Math.max(max, e.sequenceNumber), 0),
    [events]
  );

  const displayEvents = useMemo(
    () => eventsThrough(events, replayThroughSeq),
    [events, replayThroughSeq]
  );

  const sessionCostUsd = useMemo(
    () => sumEventCosts(displayEvents),
    [displayEvents]
  );

  const visibleEvents = useMemo(
    () => filterVisibleTimelineEvents(displayEvents),
    [displayEvents]
  );

  const replayPendingDecisions = useMemo(
    () => pendingCheckpointsFromEvents(displayEvents),
    [displayEvents]
  );

  const shownPendingDecisions = isReplaying
    ? replayPendingDecisions
    : pendingDecisions;

  const activeTemplate =
    expectedTemplate ??
    (session?.sessionTemplate === "incident_response" ||
    session?.sessionTemplate === "architecture_decision"
      ? session.sessionTemplate
      : null);

  useEffect(() => {
    if (replayThroughSeq != null && replayThroughSeq >= liveMaxSeq) {
      setReplayThroughSeq(null);
    }
  }, [liveMaxSeq, replayThroughSeq]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content || isStreaming || !inputEnabled) return;

    setError(null);
    setDraft("");

    if (canSuggest && !canWrite) {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/suggestions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content }),
        });
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (!res.ok) {
          throw new Error(data?.error ?? `Suggest failed (${res.status})`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to post suggestion");
        setDraft(content);
      }
      return;
    }

    if (!canWrite) {
      setError("Your role cannot post messages in this session");
      return;
    }

    setPendingUser(content);
    setCompletion("");
    setStreamText("");
    streamTextRef.current = "";
    completionLogRef.current = "";
    void complete(content);
  }

  async function onAcceptSuggestion(event: SessionEvent) {
    if (!canResolve || isStreaming) return;
    const content = eventContent(event);
    setError(null);
    setResolvingId(event.id);
    setPendingUser(content);
    setCompletion("");
    setStreamText("");
    streamTextRef.current = "";

    try {
      const res = await streamingFetch(
        `/api/sessions/${sessionId}/suggestions/${event.id}/accept`,
        { method: "POST" },
        (_piece, accumulated) => {
          flushSync(() => {
            streamTextRef.current = accumulated;
            setStreamText(accumulated);
          });
        }
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? `Accept failed (${res.status})`);
      }
      await res.text();
      const lastSeq = eventsRef.current.reduce(
        (max, e) => Math.max(max, e.sequenceNumber),
        0
      );
      await loadEvents(lastSeq);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept suggestion");
    } finally {
      setPendingUser(null);
      setStreamText("");
      streamTextRef.current = "";
      setResolvingId(null);
    }
  }

  async function onDismissSuggestion(event: SessionEvent) {
    if (!canResolve || isStreaming) return;
    setResolvingId(event.id);
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/suggestions/${event.id}/dismiss`,
        { method: "POST" }
      );
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? `Dismiss failed (${res.status})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to dismiss suggestion");
    } finally {
      setResolvingId(null);
    }
  }

  async function onTakeControl() {
    if (!canTakeControl || takingControl) return;
    setTakingControl(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/take-control`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => null)) as {
        members?: SessionMember[];
        error?: string;
      } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? `Take control failed (${res.status})`);
      }
      if (data?.members) setMembers(data.members);
      await refreshMembership();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to take control");
    } finally {
      setTakingControl(false);
    }
  }

  async function onBranchFromEvent(event: SessionEvent) {
    if (!canBranch || branchingSeq != null) return;
    setBranchingSeq(event.sequenceNumber);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/branch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fromSequenceNumber: event.sequenceNumber }),
      });
      const data = (await res.json().catch(() => null)) as {
        session?: { id: string };
        error?: string;
      } | null;
      if (!res.ok || !data?.session) {
        throw new Error(data?.error ?? `Branch failed (${res.status})`);
      }
      await refreshMembership();
      window.location.href = `/sessions/${data.session.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create branch");
      setBranchingSeq(null);
    }
  }

  async function onResolveCheckpoint(
    event: SessionEvent,
    decision: "approve" | "reject"
  ) {
    setResolvingCheckpointId(event.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/checkpoints/${event.id}/resolve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision }),
        }
      );
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? `Resolve failed (${res.status})`);
      }
      await loadEvents(0);
      await refreshMembership();
      await loadPendingDecisions();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to resolve checkpoint"
      );
    } finally {
      setResolvingCheckpointId(null);
    }
  }

  async function onGenerateHandoff() {
    if (!canGenerateHandoff || generatingHandoff) return;
    setGeneratingHandoff(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/handoff`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => null)) as {
        event?: SessionEvent;
        error?: string;
      } | null;
      if (!res.ok || !data?.event) {
        throw new Error(data?.error ?? `Handoff failed (${res.status})`);
      }
      setEvents((prev) => mergeEvents(prev, [data.event!]));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate handoff brief"
      );
    } finally {
      setGeneratingHandoff(false);
    }
  }

  const loadMemory = useCallback(async () => {
    const res = await fetch(`/api/sessions/${sessionId}/memory`);
    if (!res.ok) return;
    const data = (await res.json()) as { facts?: RecalledMemoryFact[] };
    setMemoryFacts(data.facts ?? []);
  }, [sessionId]);

  useEffect(() => {
    void loadMemory();
  }, [loadMemory, events.length]);

  async function onExtractMemory() {
    if (!canGenerateHandoff || extractingMemory) return;
    setExtractingMemory(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/memory`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        inserted?: unknown[];
      } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? `Extract failed (${res.status})`);
      }
      await loadMemory();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to extract memory facts"
      );
    } finally {
      setExtractingMemory(false);
    }
  }

  const loadTaskGraph = useCallback(async () => {
    const res = await fetch(`/api/sessions/${sessionId}/delegate`);
    if (!res.ok) return;
    const data = (await res.json()) as {
      graph?: { id: string; goal: string; status: string } | null;
      nodes?: Array<{
        id: string;
        title: string;
        status: string;
        dependsOn: string[] | null;
        childSessionId: string | null;
        assignedToType: string;
      }>;
    };
    setTaskGraph(data.graph ?? null);
    setTaskNodes(data.nodes ?? []);
  }, [sessionId]);

  useEffect(() => {
    void loadTaskGraph();
  }, [loadTaskGraph]);

  async function onDelegate() {
    if (!canGenerateHandoff || delegating || !delegateGoal.trim()) return;
    setDelegating(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/delegate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal: delegateGoal.trim() }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        graph?: { id: string; goal: string; status: string };
        nodes?: typeof taskNodes;
      } | null;
      if (!res.ok || !data?.graph) {
        throw new Error(data?.error ?? `Delegate failed (${res.status})`);
      }
      setTaskGraph(data.graph);
      setTaskNodes(data.nodes ?? []);
      setDelegateGoal("");
      await loadEvents(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delegate goal");
    } finally {
      setDelegating(false);
    }
  }

  async function onCompleteNode(nodeId: string) {
    setCompletingNodeId(nodeId);
    setError(null);
    try {
      const res = await fetch(`/api/task-nodes/${nodeId}/complete`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        graph?: { id: string; goal: string; status: string };
        nodes?: typeof taskNodes;
      } | null;
      if (!res.ok) {
        throw new Error(data?.error ?? `Complete failed (${res.status})`);
      }
      if (data?.graph) setTaskGraph(data.graph);
      if (data?.nodes) setTaskNodes(data.nodes);
      await loadEvents(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete node");
    } finally {
      setCompletingNodeId(null);
    }
  }

  async function onCompleteSession() {
    if (!canManageMembers || completingSession) return;
    setCompletingSession(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/complete`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => null)) as {
        session?: SessionDetail;
        error?: string;
      } | null;
      if (!res.ok || !data?.session) {
        throw new Error(data?.error ?? `Complete failed (${res.status})`);
      }
      setSession(data.session);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to complete session"
      );
    } finally {
      setCompletingSession(false);
    }
  }

  async function onExtractPlaybook() {
    if (!canManageMembers || extractingPlaybook || !sessionCompleted) return;
    setExtractingPlaybook(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/extract-playbook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => null)) as {
        pattern?: { id: string; name: string };
        error?: string;
      } | null;
      if (!res.ok || !data?.pattern) {
        throw new Error(data?.error ?? `Extract failed (${res.status})`);
      }
      setExtractedPatternId(data.pattern.id);
      await loadEvents(0);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to extract playbook"
      );
    } finally {
      setExtractingPlaybook(false);
    }
  }

  async function onInviteGuest() {
    if (!canManageMembers || invitingGuest) return;
    setInvitingGuest(true);
    setError(null);
    setGuestInviteUrl(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/guest-invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: guestRole,
          guest_org_name: guestOrgName.trim() || null,
          expires_in_hours: 72,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        invite?: { inviteUrl?: string };
        visibility?: string;
      } | null;
      if (!res.ok || !data?.invite?.inviteUrl) {
        throw new Error(data?.error ?? `Invite failed (${res.status})`);
      }
      setGuestInviteUrl(data.invite.inviteUrl);
      setSession((prev) =>
        prev
          ? { ...prev, visibility: data.visibility ?? "client_facing" }
          : prev
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to invite guest");
    } finally {
      setInvitingGuest(false);
    }
  }

  const displayStream = isReplaying ? "" : streamText || completion;
  const showPendingUser = !isReplaying ? pendingUser : null;
  const inputPlaceholder = isReplaying
    ? "Return to live to send messages"
    : sessionCompleted
      ? "Session completed — extract a playbook or browse Patterns"
      : sessionPaused
        ? "Session paused — resolve checkpoint to continue"
        : !inputEnabled
          ? "View only — observers cannot post"
          : canSuggest && !canWrite
            ? "Suggest a next message…"
            : "Message the session…";
  const submitLabel = isStreaming
    ? "Streaming…"
    : canSuggest && !canWrite
      ? "Suggest"
      : "Send";

  return (
    <main className="mx-auto flex h-screen max-w-3xl flex-col px-4 py-4">
      <header className="mb-4 flex items-start justify-between gap-3 border-b border-neutral-200 pb-3">
        <div className="min-w-0">
          <Link href="/sessions" className="text-sm text-neutral-500 hover:underline">
            ← Sessions
          </Link>
          <h1 className="text-xl font-semibold tracking-tight">
            {session?.title?.trim() || "Untitled session"}
          </h1>
          {sessionCompleted ? (
            <p
              data-testid="session-completed-badge"
              className="mt-1 text-xs font-medium uppercase tracking-wide text-emerald-800"
            >
              Completed
              {extractedPatternId ? (
                <>
                  {" · "}
                  <Link
                    href="/settings/patterns"
                    className="underline"
                    data-testid="extracted-playbook-link"
                  >
                    View playbook in Pattern library
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
          {activeTemplate ? (
            <p
              data-testid="session-template-badge"
              className="mt-1 text-xs font-medium uppercase tracking-wide text-indigo-800"
            >
              Template · {activeTemplate.replaceAll("_", " ")}
            </p>
          ) : null}
          {session?.parentSessionId ? (
            <p className="mt-1 text-xs text-neutral-500">
              Branched from{" "}
              <Link
                href={`/sessions/${session.parentSessionId}`}
                className="underline"
              >
                parent
              </Link>
              {session.forkedFromEventSeq != null
                ? ` @ #${session.forkedFromEventSeq}`
                : ""}
              {" · "}
              <Link
                href={`/sessions/compare?left=${session.parentSessionId}&right=${sessionId}`}
                className="underline"
              >
                Compare
              </Link>
            </p>
          ) : null}
          {childBranches.length > 0 ? (
            <p className="mt-1 text-xs text-neutral-500">
              Branches:{" "}
              {childBranches.map((b, i) => (
                <span key={b.id}>
                  {i > 0 ? ", " : null}
                  <Link href={`/sessions/${b.id}`} className="underline">
                    @{b.forkedFromEventSeq}
                  </Link>
                  {canMerge ? (
                    <>
                      {" "}
                      (
                      <Link
                        href={`/sessions/compare?left=${sessionId}&right=${b.id}`}
                        className="underline"
                      >
                        compare/merge
                      </Link>
                      )
                    </>
                  ) : null}
                </span>
              ))}
            </p>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {membership?.role ? (
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${roleBadgeClass(membership.role)}`}
              >
                you · {membership.role}
              </span>
            ) : null}
            <span className="text-xs text-neutral-500">
              {liveReady ? "live" : "…"}
            </span>
          </div>
          {members.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="member-badges">
              {members.map((member) => (
                <li
                  key={member.userId}
                  className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${roleBadgeClass(member.role)}`}
                  title={member.email ?? member.userId}
                >
                  {(member.name || member.email || member.userId.slice(0, 8)) +
                    (member.userId === membership?.userId ? " (you)" : "")}{" "}
                  · {member.role}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <p
            data-testid="session-cost-meter"
            className="rounded-md border border-neutral-200 bg-white px-2 py-1 font-mono text-xs tabular-nums text-neutral-800"
            title="Running sum of cost_usd on session events"
          >
            Cost · ${formatUsd(sessionCostUsd)}
          </p>
          <p className="font-mono text-xs text-neutral-400">
            {sessionId.slice(0, 8)}…
          </p>
          <div className="flex flex-col items-end gap-1.5">
            {canGenerateHandoff ? (
              <button
                type="button"
                data-testid="generate-handoff"
                disabled={generatingHandoff || isReplaying}
                onClick={() => void onGenerateHandoff()}
                className="rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs text-sky-900 disabled:opacity-50"
              >
                {generatingHandoff ? "Generating…" : "Generate handoff"}
              </button>
            ) : null}
            {canGenerateHandoff ? (
              <button
                type="button"
                data-testid="extract-memory"
                disabled={extractingMemory || isReplaying}
                onClick={() => void onExtractMemory()}
                className="rounded-md border border-teal-300 bg-teal-50 px-2.5 py-1 text-xs text-teal-900 disabled:opacity-50"
              >
                {extractingMemory ? "Extracting…" : "Extract memory"}
              </button>
            ) : null}
            {canManageMembers && !sessionCompleted ? (
              <button
                type="button"
                data-testid="complete-session"
                disabled={completingSession || sessionPaused || isReplaying}
                onClick={() => void onCompleteSession()}
                className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-800 disabled:opacity-50"
              >
                {completingSession ? "Completing…" : "Mark completed"}
              </button>
            ) : null}
            {canManageMembers && sessionCompleted ? (
              <button
                type="button"
                data-testid="make-repeatable"
                disabled={extractingPlaybook || isReplaying}
                onClick={() => void onExtractPlaybook()}
                className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-900 disabled:opacity-50"
              >
                {extractingPlaybook
                  ? "Extracting…"
                  : "Make this repeatable"}
              </button>
            ) : null}
            {canTakeControl ? (
              <button
                type="button"
                data-testid="take-control"
                disabled={takingControl || membership?.role === "pilot"}
                onClick={() => void onTakeControl()}
                className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-800 disabled:opacity-50"
              >
                {membership?.role === "pilot" || membership?.role === "owner"
                  ? membership?.role === "pilot"
                    ? "You are pilot"
                    : "Take control"
                  : takingControl
                    ? "Taking…"
                    : "Take control"}
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {error ? (
        <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {session?.visibility === "client_facing" ? (
        <p
          data-testid="client-facing-banner"
          className="mb-3 rounded-md border-2 border-amber-500 bg-amber-100 px-3 py-2 text-sm text-amber-950"
        >
          Client-facing session — guests with a magic link can view this
          session. Internal-only work should stay on a separate session.
        </p>
      ) : null}

      {canManageMembers && !isReplaying ? (
        <section
          data-testid="guest-invite-panel"
          className="mb-3 rounded-md border border-amber-200 bg-white px-3 py-2"
        >
          <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-900">
            Invite guest
          </h2>
          <p className="mt-1 text-xs text-neutral-600">
            Magic link only — no Clerk account. Sets session to client-facing.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="text-xs">
              Role
              <select
                value={guestRole}
                onChange={(e) =>
                  setGuestRole(e.target.value as "observer" | "reviewer")
                }
                className="mt-0.5 block border border-neutral-300 px-2 py-1"
              >
                <option value="observer">observer</option>
                <option value="reviewer">reviewer</option>
              </select>
            </label>
            <label className="text-xs">
              Guest org (optional)
              <input
                value={guestOrgName}
                onChange={(e) => setGuestOrgName(e.target.value)}
                className="mt-0.5 block border border-neutral-300 px-2 py-1"
                placeholder="Acme Client"
              />
            </label>
            <button
              type="button"
              data-testid="invite-guest"
              disabled={invitingGuest}
              onClick={() => void onInviteGuest()}
              className="rounded-md bg-amber-900 px-3 py-1.5 text-xs text-white disabled:opacity-50"
            >
              {invitingGuest ? "Creating…" : "Generate link"}
            </button>
          </div>
          {guestInviteUrl ? (
            <p
              data-testid="guest-invite-url"
              className="mt-2 break-all font-mono text-xs text-amber-950"
            >
              {guestInviteUrl}
            </p>
          ) : null}
        </section>
      ) : null}

      {sessionPaused && !isReplaying ? (
        <p
          data-testid="checkpoint-paused"
          className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900"
        >
          Session paused — a checkpoint is waiting for resolution. New messages
          are blocked until it is approved or rejected.
        </p>
      ) : null}

      <TimelineScrubber
        events={events}
        throughSequence={replayThroughSeq}
        onScrub={(seq) => setReplayThroughSeq(seq)}
        onReturnLive={() => setReplayThroughSeq(null)}
      />

      <section
        data-testid="pending-decisions"
        className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2"
      >
        <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-900">
          Pending decisions
          {isReplaying ? " (as of scrub)" : ""}
        </h2>
        {shownPendingDecisions.length === 0 ? (
          <p className="mt-1 text-sm text-amber-800/80">
            No open checkpoints.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {shownPendingDecisions.map((item) => (
              <li
                key={item.id}
                data-testid={`pending-decision-${item.id}`}
                className="text-sm text-amber-950"
              >
                <span className="font-medium">
                  #{item.sequenceNumber} · {item.policyName}
                </span>
                {item.reason ? (
                  <span className="block text-amber-900/90">{item.reason}</span>
                ) : null}
                <span className="block text-xs text-amber-800">
                  Requires: {item.requiredRole ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        data-testid="memory-panel"
        className="mb-3 rounded-md border border-teal-200 bg-teal-50/60 px-3 py-2"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-teal-900">
            Team memory
          </h2>
          <Link
            href="/settings/memory"
            className="text-xs text-teal-800 underline"
          >
            Curation queue
          </Link>
        </div>
        {memoryFacts.length === 0 ? (
          <p className="mt-1 text-sm text-teal-900/70">
            No curated facts recalled for this context yet. Extract from this
            session, then approve facts in settings.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {memoryFacts.map((fact) => (
              <li
                key={fact.id}
                data-testid={`recalled-fact-${fact.id}`}
                className="text-sm text-teal-950"
              >
                <span className="font-medium">{fact.fact}</span>
                <span className="mt-0.5 block text-xs text-teal-800">
                  {fact.scope}
                  {fact.sourceSessionId ? (
                    <>
                      {" · "}
                      <Link
                        href={`/sessions/${fact.sourceSessionId}`}
                        className="underline"
                      >
                        {fact.sourceSessionTitle?.trim() || "source session"}
                      </Link>
                      {fact.sourceEventSeq != null
                        ? ` #${fact.sourceEventSeq}`
                        : null}
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        data-testid="delegation-panel"
        className="mb-3 rounded-md border border-violet-200 bg-violet-50/50 px-3 py-2"
      >
        <h2 className="text-xs font-semibold uppercase tracking-wide text-violet-900">
          Delegation / Manager Agent
        </h2>
        {canGenerateHandoff &&
        (!taskGraph || taskGraph.status === "completed") ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              data-testid="delegate-goal-input"
              value={delegateGoal}
              onChange={(e) => setDelegateGoal(e.target.value)}
              placeholder="State a goal to delegate…"
              className="min-w-[12rem] flex-1 border border-violet-200 bg-white px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              data-testid="delegate-submit"
              disabled={delegating || !delegateGoal.trim() || isReplaying}
              onClick={() => void onDelegate()}
              className="rounded-md bg-violet-900 px-3 py-1.5 text-xs text-white disabled:opacity-50"
            >
              {delegating ? "Planning…" : "Delegate"}
            </button>
          </div>
        ) : null}
        {taskGraph ? (
          <div className="mt-2">
            <p className="text-sm text-violet-950">
              <span className="font-medium">{taskGraph.status}</span>
              {" · "}
              {taskGraph.goal}
            </p>
            <ul className="mt-2 space-y-2">
              {taskNodes.map((node) => (
                <li
                  key={node.id}
                  data-testid={`task-node-${node.id}`}
                  className="rounded border border-violet-100 bg-white px-2 py-1.5 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-medium">{node.title}</span>
                      <span className="ml-2 text-xs text-violet-700">
                        {node.status} · {node.assignedToType}
                        {(node.dependsOn?.length ?? 0) > 0
                          ? ` · waits on ${node.dependsOn!.length}`
                          : null}
                      </span>
                    </span>
                    <span className="flex gap-2">
                      {node.childSessionId ? (
                        <Link
                          href={`/sessions/${node.childSessionId}`}
                          className="text-xs underline"
                        >
                          Open session
                        </Link>
                      ) : null}
                      {canGenerateHandoff &&
                      (node.status === "in_progress" ||
                        node.status === "pending") ? (
                        <button
                          type="button"
                          data-testid={`complete-node-${node.id}`}
                          disabled={completingNodeId === node.id || isReplaying}
                          onClick={() => void onCompleteNode(node.id)}
                          className="text-xs text-violet-900 underline disabled:opacity-50"
                        >
                          {completingNodeId === node.id
                            ? "Completing…"
                            : "Mark complete"}
                        </button>
                      ) : null}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-1 text-sm text-violet-900/70">
            No active task graph. Submit a goal to run the Manager Agent
            (mock decomposition in mock mode).
          </p>
        )}
      </section>

      <PatternScaffoldPanel events={displayEvents} />
      {activeTemplate ? (
        <>
          <RelatedContextPanel events={displayEvents} />
          <TemplateStructuredPanels
            sessionId={sessionId}
            templateId={activeTemplate}
            events={displayEvents}
            canEdit={canWrite && !sessionPaused && !isReplaying}
            onEventsChanged={async () => {
              await loadEvents(0);
            }}
          />
        </>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-neutral-200 bg-neutral-50 px-3 py-4">
        {loading ? (
          <p className="text-sm text-neutral-500">Loading messages…</p>
        ) : visibleEvents.length === 0 && !showPendingUser && !displayStream ? (
          <p className="text-center text-sm text-neutral-500">
            {activeTemplate
              ? "No messages yet. Use the panels above or send a message."
              : "No messages yet. Send one to start the turn."}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {visibleEvents.map((event) => {
              if (event.eventType === "role_change") {
                return (
                  <li key={event.id} className="flex justify-center">
                    <p className="text-center text-xs text-neutral-500">
                      #{event.sequenceNumber} · {eventContent(event)}
                    </p>
                  </li>
                );
              }

              if (event.eventType === "handoff_brief") {
                const since =
                  typeof event.payload.since_sequence === "number"
                    ? event.payload.since_sequence
                    : 0;
                const through =
                  typeof event.payload.through_sequence === "number"
                    ? event.payload.through_sequence
                    : event.sequenceNumber;
                const eventCount =
                  typeof event.payload.event_count === "number"
                    ? event.payload.event_count
                    : null;

                return (
                  <li key={event.id} className="flex justify-center">
                    <div
                      data-testid="handoff-brief-card"
                      className="w-full max-w-[90%] rounded-xl border-2 border-sky-400 bg-sky-50 px-3 py-3 text-sm text-sky-950"
                    >
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
                        Handoff brief · #{event.sequenceNumber}
                      </p>
                      <p className="mb-2 text-xs text-sky-800">
                        Events {since === 0 ? "from start" : `after #${since}`}{" "}
                        through #{through}
                        {eventCount != null ? ` · ${eventCount} events` : ""}
                      </p>
                      <p className="whitespace-pre-wrap">{eventContent(event)}</p>
                    </div>
                  </li>
                );
              }

              if (event.eventType === "manager_brief") {
                const facts = Array.isArray(event.payload.recalled_facts)
                  ? event.payload.recalled_facts
                  : [];
                return (
                  <li key={event.id} className="flex justify-center">
                    <div
                      data-testid="manager-brief-card"
                      className="w-full max-w-[90%] rounded-xl border-2 border-violet-300 bg-violet-50 px-3 py-3 text-sm text-violet-950"
                    >
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                        Chief of Staff · #{event.sequenceNumber}
                      </p>
                      <p className="mb-2 text-xs text-violet-800">
                        {typeof event.payload.note === "string"
                          ? event.payload.note
                          : "Planning recall"}
                      </p>
                      {facts.length === 0 ? (
                        <p className="text-xs text-violet-700">
                          No curated memory facts matched this goal.
                        </p>
                      ) : (
                        <ul className="space-y-1 text-xs">
                          {facts.map((f, i) => {
                            const fact =
                              f &&
                              typeof f === "object" &&
                              "fact" in f &&
                              typeof (f as { fact: unknown }).fact === "string"
                                ? (f as { fact: string }).fact
                                : JSON.stringify(f);
                            return <li key={i}>• {fact}</li>;
                          })}
                        </ul>
                      )}
                    </div>
                  </li>
                );
              }

              if (event.eventType === "delegation_synthesis") {
                return (
                  <li key={event.id} className="flex justify-center">
                    <div
                      data-testid="delegation-synthesis-card"
                      className="w-full max-w-[90%] rounded-xl border-2 border-violet-400 bg-violet-50 px-3 py-3 text-sm text-violet-950"
                    >
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                        Delegation synthesis · #{event.sequenceNumber}
                      </p>
                      <p className="whitespace-pre-wrap">
                        {eventContent(event)}
                      </p>
                    </div>
                  </li>
                );
              }

              if (event.eventType === "checkpoint_raised") {
                const requiredRole =
                  typeof event.payload.required_role === "string"
                    ? event.payload.required_role
                    : null;
                const canResolveCheckpoint =
                  !isReplaying &&
                  requiredRole != null &&
                  membership?.role === requiredRole;
                const reason =
                  typeof event.payload.reason === "string"
                    ? event.payload.reason
                    : "Checkpoint raised";
                const policyName =
                  typeof event.payload.policy_name === "string"
                    ? event.payload.policy_name
                    : "Policy";

                return (
                  <li key={event.id} className="flex justify-center">
                    <div
                      data-testid="checkpoint-card"
                      className="w-full max-w-[90%] rounded-xl border-2 border-rose-400 bg-rose-50 px-3 py-3 text-sm text-rose-950"
                    >
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-rose-700">
                        Checkpoint · #{event.sequenceNumber}
                      </p>
                      <p className="font-medium">{policyName}</p>
                      <p className="mt-1 text-sm">{reason}</p>
                      <p className="mt-1 text-xs text-rose-700">
                        Requires role: {requiredRole ?? "—"}
                      </p>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          disabled={
                            !canResolveCheckpoint ||
                            resolvingCheckpointId === event.id
                          }
                          onClick={() =>
                            void onResolveCheckpoint(event, "approve")
                          }
                          className="rounded-md bg-rose-900 px-2.5 py-1 text-xs text-white disabled:opacity-40"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={
                            !canResolveCheckpoint ||
                            resolvingCheckpointId === event.id
                          }
                          onClick={() =>
                            void onResolveCheckpoint(event, "reject")
                          }
                          className="rounded-md border border-rose-400 bg-white px-2.5 py-1 text-xs text-rose-900 disabled:opacity-40"
                        >
                          Reject
                        </button>
                      </div>
                      {!canResolveCheckpoint ? (
                        <p className="mt-2 text-[11px] text-rose-700">
                          Waiting for a {requiredRole} to resolve.
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              }

              if (event.eventType === "suggestion") {
                return (
                  <li key={event.id} className="flex justify-center">
                    <div className="w-full max-w-[90%] rounded-xl border border-dashed border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-amber-700">
                        Suggestion · #{event.sequenceNumber}
                      </p>
                      <p className="whitespace-pre-wrap">{eventContent(event)}</p>
                      {canResolve ? (
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            disabled={isStreaming || resolvingId === event.id}
                            onClick={() => void onAcceptSuggestion(event)}
                            className="rounded-md bg-amber-900 px-2.5 py-1 text-xs text-white disabled:opacity-50"
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            disabled={isStreaming || resolvingId === event.id}
                            onClick={() => void onDismissSuggestion(event)}
                            className="rounded-md border border-amber-400 bg-white px-2.5 py-1 text-xs text-amber-900 disabled:opacity-50"
                          >
                            Dismiss
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              }

              const userSide = isUserSide(event);
              return (
                <li
                  key={event.id}
                  className={`flex ${userSide ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                      userSide
                        ? "bg-neutral-900 text-white"
                        : "border border-neutral-200 bg-white text-neutral-900"
                    }`}
                  >
                    <p className="mb-1 text-[10px] uppercase tracking-wide opacity-60">
                      {userSide ? "You" : "Agent"} · #{event.sequenceNumber}
                    </p>
                    {eventContent(event)}
                    {canBranch ? (
                      <button
                        type="button"
                        data-testid={`branch-from-${event.sequenceNumber}`}
                        disabled={branchingSeq === event.sequenceNumber}
                        onClick={() => void onBranchFromEvent(event)}
                        className={`mt-2 block text-[10px] uppercase tracking-wide underline opacity-70 hover:opacity-100 disabled:opacity-40 ${
                          userSide ? "text-neutral-300" : "text-neutral-500"
                        }`}
                      >
                        {branchingSeq === event.sequenceNumber
                          ? "Branching…"
                          : "Branch from here"}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}

            {showPendingUser ? (
              <li className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl bg-neutral-900 px-3 py-2 text-sm whitespace-pre-wrap text-white">
                  <p className="mb-1 text-[10px] uppercase tracking-wide opacity-60">
                    You · sending
                  </p>
                  {showPendingUser}
                </div>
              </li>
            ) : null}

            {!isReplaying && (isStreaming || displayStream) ? (
              <li className="flex justify-start">
                <div
                  data-testid="streaming-agent"
                  className="max-w-[80%] rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm whitespace-pre-wrap text-neutral-900"
                >
                  <p className="mb-1 text-[10px] uppercase tracking-wide opacity-60">
                    Agent · streaming
                  </p>
                  {displayStream || (isStreaming ? "…" : "")}
                </div>
              </li>
            ) : null}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={onSubmit} className="mt-3 flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={inputPlaceholder}
          disabled={isStreaming || loading || !inputEnabled}
          className="min-w-0 flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500 disabled:bg-neutral-100"
        />
        <button
          type="submit"
          disabled={isStreaming || loading || !draft.trim() || !inputEnabled}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </form>
    </main>
  );
}
