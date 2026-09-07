import { Suspense } from "react";
import BranchCompareClient from "./compare-client";

export default function BranchComparePage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm">Loading compare…</p>}>
      <BranchCompareClient />
    </Suspense>
  );
}
