"use client";

import SessionViewClient from "./session-view-client";

/** Purpose-built architecture canvas — shared timeline + decision panels. */
export default function ArchitectureSessionView({
  sessionId,
}: {
  sessionId: string;
}) {
  return (
    <SessionViewClient
      sessionId={sessionId}
      expectedTemplate="architecture_decision"
    />
  );
}
