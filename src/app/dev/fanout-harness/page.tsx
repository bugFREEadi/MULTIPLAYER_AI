import { Suspense } from "react";
import FanoutHarnessPage from "./fanout-client";

export default function Page() {
  return (
    <Suspense fallback={<p className="p-6 text-sm">Loading…</p>}>
      <FanoutHarnessPage />
    </Suspense>
  );
}
