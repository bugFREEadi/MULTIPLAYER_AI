import { auth } from "@clerk/nextjs/server";
import CheckpointPoliciesClient from "./policies-client";

export default async function PoliciesPage() {
  await auth.protect();
  return <CheckpointPoliciesClient />;
}
