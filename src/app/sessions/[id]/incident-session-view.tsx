"use client";

import SessionViewClient from "./session-view-client";

/** Purpose-built incident canvas — shared timeline + incident structured panels. */
export default function IncidentSessionView({
  sessionId,
}: {
  sessionId: string;
}) {
  return (
    <SessionViewClient
      sessionId={sessionId}
      expectedTemplate="incident_response"
    />
  );
}
