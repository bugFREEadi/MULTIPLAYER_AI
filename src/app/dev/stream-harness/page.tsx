"use client";

/**
 * Dev-only streaming harness — same useCompletion + tee-fetch pattern as the
 * session view, authenticated via x-dev-clerk-id (ALLOW_DEV_AUTH).
 */
import { useCompletion } from "@ai-sdk/react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

const DEV_HEADERS = {
  "x-dev-clerk-id": "stream_harness",
  "x-dev-user-name": "Stream Harness",
  "x-dev-user-email": "stream-harness@localhost",
};

function streamingFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  onRawChunk: (text: string, accumulated: string) => void
): Promise<Response> {
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(DEV_HEADERS)) {
    headers.set(k, v);
  }
  return fetch(input, { ...init, headers }).then((response) => {
    if (!response.body) return response;
    const [forLog, forHook] = response.body.tee();
    const decoder = new TextDecoder();
    let accumulated = "";
    let chunkIndex = 0;
    void (async () => {
      const reader = forLog.getReader();
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
          JSON.stringify(text)
        );
        onRawChunk(text, accumulated);
      }
      console.log(
        "[mock-stream client raw]",
        new Date().toISOString(),
        "done",
        `chunks=${chunkIndex}`
      );
    })();
    return new Response(forHook, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  });
}

function StreamRunner({ sessionId }: { sessionId: string }) {
  const [streamText, setStreamText] = useState("");
  const [status, setStatus] = useState("ready");
  const [lengths, setLengths] = useState<number[]>([]);
  const started = useRef(false);
  const completionLogRef = useRef("");

  const { completion, complete, isLoading } = useCompletion({
    api: `/api/sessions/${sessionId}/stream`,
    streamProtocol: "text",
    headers: DEV_HEADERS,
    fetch: (input, init) =>
      streamingFetch(input, init, (_piece, accumulated) => {
        flushSync(() => {
          setStreamText(accumulated);
          setLengths((prev) => [...prev, accumulated.length]);
        });
      }),
    onFinish: () => {
      setStatus("finished");
    },
  });

  useEffect(() => {
    if (completion === completionLogRef.current) return;
    console.log(
      "[mock-stream client completion]",
      new Date().toISOString(),
      `len=${completion.length}`,
      `delta=${JSON.stringify(
        completion.startsWith(completionLogRef.current)
          ? completion.slice(completionLogRef.current.length)
          : completion
      )}`
    );
    completionLogRef.current = completion;
  }, [completion]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    setStatus("streaming");
    void complete(
      "Please stream this harness message with enough length to see chunks clearly over time"
    );
  }, [complete]);

  return (
    <>
      <p data-testid="status" className="text-sm text-neutral-500">
        {status} {isLoading ? "(loading)" : ""}
      </p>
      <p data-testid="length-samples" className="font-mono text-xs break-all">
        lengths={JSON.stringify(lengths)}
      </p>
      <pre
        data-testid="streaming-agent"
        className="mt-4 whitespace-pre-wrap rounded border bg-neutral-50 p-3 text-sm"
      >
        {streamText || "…"}
      </pre>
    </>
  );
}

export default function StreamHarnessPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json", ...DEV_HEADERS },
        body: JSON.stringify({ title: "stream harness" }),
      });
      const data = (await res.json()) as {
        session?: { id: string };
        error?: string;
      };
      if (!res.ok || !data.session) {
        setError(data.error ?? `Failed (${res.status})`);
        return;
      }
      setSessionId(data.session.id);
    })();
  }, []);

  return (
    <main className="mx-auto max-w-xl p-6 font-sans">
      <h1 className="text-lg font-semibold">Stream harness</h1>
      {error ? <p className="text-red-600">{error}</p> : null}
      {!sessionId && !error ? (
        <p data-testid="status">creating-session</p>
      ) : null}
      {sessionId ? <StreamRunner sessionId={sessionId} /> : null}
    </main>
  );
}
